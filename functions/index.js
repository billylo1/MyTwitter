/**
 * MyTwitter Cloud Functions — poll each user's X home timeline.
 *
 * Supports:
 *   - OAuth 1.0a user tokens stored on users/{uid}.oauth1
 *   - OAuth 2.0 refresh tokens on users/{uid}.refreshToken
 *
 * Prefers v2 homeTimeline; falls back to v1.1 if v2 is blocked.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { TwitterApi } = require("twitter-api-v2");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

const xClientId = defineSecret("X_CLIENT_ID");
const xClientSecret = defineSecret("X_CLIENT_SECRET");
const xApiKey = defineSecret("X_API_KEY");
const xApiSecret = defineSecret("X_API_SECRET");
const xBearerToken = defineSecret("X_BEARER_TOKEN");

/** Pay-per-use post-read price (USD). Keep in sync with X console. */
const POST_READ_PRICE_USD = 0.005;

const TWEET_FIELDS = [
  "created_at",
  "author_id",
  "attachments",
  "referenced_tweets",
  "entities",
];
const EXPANSIONS = ["author_id", "attachments.media_keys"];
const MEDIA_FIELDS = ["url", "preview_image_url", "type", "width", "height"];
const USER_FIELDS = ["name", "username", "profile_image_url"];

async function getUserClient(userDoc, secrets) {
  const data = userDoc.data();

  // Prefer OAuth 2.0 when we have a refresh token (pay-per-use / Basic).
  // Only use OAuth 1.0a when authType is explicitly oauth1, or when there
  // is no refresh token but oauth1 credentials exist.
  const preferOauth1 =
    data?.authType === "oauth1" ||
    (!data?.refreshToken && data?.oauth1?.accessToken);

  if (preferOauth1 && data?.oauth1?.accessToken) {
    const o = data.oauth1 || {};
    const appKey = o.appKey || secrets.apiKey;
    const appSecret = o.appSecret || secrets.apiSecret;
    if (!appKey || !appSecret || !o.accessToken || !o.accessSecret) {
      throw new Error(`User ${userDoc.id} missing oauth1 credentials`);
    }
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken: o.accessToken,
      accessSecret: o.accessSecret,
    });
    return {
      client,
      xUserId: data.xUserId || userDoc.id,
      handle: data.handle,
      authType: "oauth1",
    };
  }

  if (!data?.refreshToken) {
    throw new Error(`User ${userDoc.id} has no oauth1 or refreshToken`);
  }

  const oauthClient = new TwitterApi({
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
  });

  const {
    client,
    accessToken,
    refreshToken,
    expiresIn,
  } = await oauthClient.refreshOAuth2Token(data.refreshToken);

  const updates = {
    accessToken,
    tokenRefreshedAt: FieldValue.serverTimestamp(),
  };
  if (refreshToken) updates.refreshToken = refreshToken;
  if (expiresIn) {
    updates.tokenExpiresAt = Timestamp.fromMillis(Date.now() + expiresIn * 1000);
  }
  await userDoc.ref.set(updates, { merge: true });

  return {
    client,
    xUserId: data.xUserId,
    handle: data.handle,
    authType: "oauth2",
  };
}

function isReplyV2(tweet) {
  return (tweet.referenced_tweets || []).some((r) => r.type === "replied_to");
}

function isRetweetV2(tweet) {
  return (tweet.referenced_tweets || []).some((r) => r.type === "retweeted");
}

function mediaUrlsV2(tweet, includes) {
  const keys = tweet.attachments?.media_keys || [];
  if (!keys.length || !includes?.media) return [];
  return keys
    .map((key) => includes.media.find((m) => m.media_key === key))
    .filter(Boolean)
    .map((m) => m.url || m.preview_image_url)
    .filter(Boolean);
}

function mapTweetV2(tweet, includes) {
  const author =
    includes?.users?.find((u) => u.id === tweet.author_id) || null;
  return {
    text: tweet.text || "",
    authorId: tweet.author_id || null,
    authorName: author?.name || "Unknown",
    authorHandle: author?.username || "unknown",
    authorAvatar: author?.profile_image_url
      ? author.profile_image_url.replace("_normal", "_bigger")
      : null,
    createdAt: tweet.created_at
      ? Timestamp.fromDate(new Date(tweet.created_at))
      : FieldValue.serverTimestamp(),
    mediaUrls: mediaUrlsV2(tweet, includes),
    url: author?.username
      ? `https://x.com/${author.username}/status/${tweet.id}`
      : `https://x.com/i/status/${tweet.id}`,
    isRetweet: isRetweetV2(tweet),
    fetchedAt: FieldValue.serverTimestamp(),
  };
}

function mediaUrlsV1(tweet) {
  const media =
    tweet.extended_entities?.media || tweet.entities?.media || [];
  return media
    .map((m) => m.media_url_https || m.media_url)
    .filter(Boolean);
}

function mapTweetV1(tweet) {
  const user = tweet.user || {};
  const handle = user.screen_name || "unknown";
  return {
    text: tweet.full_text || tweet.text || "",
    authorId: user.id_str || null,
    authorName: user.name || "Unknown",
    authorHandle: handle,
    authorAvatar: user.profile_image_url_https
      ? user.profile_image_url_https.replace("_normal", "_bigger")
      : null,
    createdAt: tweet.created_at
      ? Timestamp.fromDate(new Date(tweet.created_at))
      : FieldValue.serverTimestamp(),
    mediaUrls: mediaUrlsV1(tweet),
    url: `https://x.com/${handle}/status/${tweet.id_str}`,
    isRetweet: Boolean(tweet.retweeted_status),
    fetchedAt: FieldValue.serverTimestamp(),
  };
}

async function syncViaV2(client, userDoc, sinceId) {
  const params = {
    exclude: ["replies"],
    max_results: 100,
    "tweet.fields": TWEET_FIELDS,
    expansions: EXPANSIONS,
    "media.fields": MEDIA_FIELDS,
    "user.fields": USER_FIELDS,
  };
  if (sinceId) params.since_id = sinceId;
  else {
    params.start_time = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();
  }

  let paginator = await client.v2.homeTimeline(params);
  let fetched = 0;
  let written = 0;
  let newestId = sinceId || null;
  const postsCol = userDoc.ref.collection("posts");
  const authorsCol = userDoc.ref.collection("authors");
  const MAX_PAGES = sinceId ? 5 : 2;

  for (let page = 0; page < MAX_PAGES; page++) {
    const tweets = paginator.tweets || [];
    const includes = paginator.includes || {};

    for (const user of includes.users || []) {
      await authorsCol.doc(user.id).set(
        {
          name: user.name,
          username: user.username,
          profileImageUrl: user.profile_image_url || null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    for (const tweet of tweets) {
      fetched += 1;
      if (isReplyV2(tweet)) continue;
      if (!newestId || BigInt(tweet.id) > BigInt(newestId)) {
        newestId = tweet.id;
      }
      await postsCol.doc(tweet.id).set(mapTweetV2(tweet, includes), {
        merge: true,
      });
      written += 1;
    }

    if (!paginator.meta?.next_token || tweets.length === 0) break;
    await paginator.fetchNext();
  }

  return { fetched, written, newestId, api: "v2" };
}

async function syncViaV1(client, userDoc, sinceId) {
  const opts = {
    exclude_replies: true,
    count: 100,
    tweet_mode: "extended",
  };
  if (sinceId) opts.since_id = sinceId;

  const paginator = await client.v1.homeTimeline(opts);
  const tweets = paginator.tweets || [];
  let fetched = 0;
  let written = 0;
  let newestId = sinceId || null;
  const postsCol = userDoc.ref.collection("posts");
  const authorsCol = userDoc.ref.collection("authors");

  // First sync: keep only last 24h
  const cutoff = sinceId ? 0 : Date.now() - 24 * 60 * 60 * 1000;

  for (const tweet of tweets) {
    fetched += 1;
    if (tweet.in_reply_to_status_id_str) continue;
    const created = tweet.created_at
      ? new Date(tweet.created_at).getTime()
      : Date.now();
    if (cutoff && created < cutoff) continue;

    if (!newestId || BigInt(tweet.id_str) > BigInt(newestId)) {
      newestId = tweet.id_str;
    }
    if (tweet.user?.id_str) {
      await authorsCol.doc(tweet.user.id_str).set(
        {
          name: tweet.user.name,
          username: tweet.user.screen_name,
          profileImageUrl: tweet.user.profile_image_url_https || null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    await postsCol.doc(tweet.id_str).set(mapTweetV1(tweet), { merge: true });
    written += 1;
  }

  return { fetched, written, newestId, api: "v1" };
}

async function syncUser(userDoc, secrets) {
  const uid = userDoc.id;
  const syncRef = userDoc.ref.collection("sync").doc("state");
  const syncSnap = await syncRef.get();
  const sinceId = syncSnap.exists ? syncSnap.data()?.sinceId : null;

  const { client } = await getUserClient(userDoc, secrets);

  let result;
  try {
    result = await syncViaV2(client, userDoc, sinceId);
  } catch (err) {
    logger.warn("v2 homeTimeline failed, trying v1.1", {
      uid,
      error: err.message,
      reason: err.data?.reason,
      code: err.code,
    });
    result = await syncViaV1(client, userDoc, sinceId);
  }

  await syncRef.set(
    {
      sinceId: result.newestId || sinceId || null,
      lastSyncAt: FieldValue.serverTimestamp(),
      lastFetched: result.fetched,
      lastWritten: result.written,
      lastApi: result.api,
      lastError: null,
    },
    { merge: true }
  );

  await userDoc.ref.set(
    {
      accessBlocked: false,
      accessBlockedReason: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return result;
}

async function fetchAndStoreUsage(secrets) {
  if (!secrets.bearerToken) {
    logger.warn("X_BEARER_TOKEN missing; skipping usage refresh");
    return null;
  }

  try {
    const appOnly = new TwitterApi(secrets.bearerToken);
    const res = await appOnly.v2.get("usage/tweets");
    const data = res?.data || res;
    const cyclePostsRead = Number(data.project_usage ?? 0);
    const projectCap = Number(data.project_cap ?? 0);
    const capResetDay = data.cap_reset_day ?? null;

    const publicRef = db.collection("config").doc("public");
    const prevSnap = await publicRef.get();
    const prev = prevSnap.exists ? prevSnap.data()?.usage || {} : {};
    const prevCycle = Number(prev.cyclePostsRead ?? prev.postsRead ?? 0);
    let priorCyclesPostsRead = Number(prev.priorCyclesPostsRead ?? 0);

    // Billing cycle reset: X project_usage drops; fold the finished cycle in.
    if (prevCycle > 0 && cyclePostsRead < prevCycle) {
      priorCyclesPostsRead += prevCycle;
    }

    const postsReadCumulative = priorCyclesPostsRead + cyclePostsRead;
    const estimatedCostUsd =
      Math.round(postsReadCumulative * POST_READ_PRICE_USD * 1000) / 1000;

    await publicRef.set(
      {
        usage: {
          postsRead: postsReadCumulative,
          postsReadCumulative,
          cyclePostsRead,
          priorCyclesPostsRead,
          projectCap,
          capResetDay,
          pricePerPostUsd: POST_READ_PRICE_USD,
          estimatedCostUsd,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    return {
      postsRead: postsReadCumulative,
      postsReadCumulative,
      cyclePostsRead,
      estimatedCostUsd,
      projectCap,
      capResetDay,
    };
  } catch (err) {
    logger.warn("Failed to refresh X usage", {
      error: err.message,
      data: err.data,
    });
    return null;
  }
}

async function runSyncAll(secrets) {
  const usersSnap = await db
    .collection("users")
    .where("enabled", "==", true)
    .get();

  if (usersSnap.empty) {
    logger.warn("No enabled users to sync");
    const usage = await fetchAndStoreUsage(secrets);
    return { users: 0, results: [], usage };
  }

  const results = [];
  for (const userDoc of usersSnap.docs) {
    try {
      const stats = await syncUser(userDoc, secrets);
      logger.info("Synced user", { uid: userDoc.id, ...stats });
      results.push({ uid: userDoc.id, ok: true, ...stats });
    } catch (err) {
      const detail =
        err.data?.detail ||
        err.data?.errors?.[0]?.message ||
        err.message;
      logger.error("Sync failed", { uid: userDoc.id, error: detail });
      await userDoc.ref.collection("sync").doc("state").set(
        {
          lastError: String(detail),
          lastSyncAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await userDoc.ref.set(
        {
          accessBlocked: true,
          accessBlockedReason: String(detail),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      results.push({ uid: userDoc.id, ok: false, error: String(detail) });
    }
  }

  const usage = await fetchAndStoreUsage(secrets);
  return { users: usersSnap.size, results, usage };
}

const secretOpts = {
  secrets: [xClientId, xClientSecret, xApiKey, xApiSecret, xBearerToken],
  timeoutSeconds: 300,
  memory: "512MiB",
  region: "us-central1",
};

function secretsFromEnv() {
  return {
    clientId: xClientId.value(),
    clientSecret: xClientSecret.value(),
    apiKey: xApiKey.value(),
    apiSecret: xApiSecret.value(),
    bearerToken: xBearerToken.value(),
  };
}

exports.syncTimeline = onSchedule(
  {
    schedule: "every 10 minutes",
    ...secretOpts,
  },
  async () => {
    const summary = await runSyncAll(secretsFromEnv());
    logger.info("syncTimeline done", summary);
  }
);

exports.syncNow = onRequest(secretOpts, async (req, res) => {
  const expected = process.env.SYNC_NOW_KEY;
  if (expected && req.query.key !== expected) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    const summary = await runSyncAll(secretsFromEnv());
    res.json({ ok: true, ...summary });
  } catch (err) {
    logger.error("syncNow failed", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});
