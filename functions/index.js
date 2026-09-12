/**
 * MyTwitter Cloud Functions — X OAuth login, family membership, timeline sync.
 */

const crypto = require("crypto");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { TwitterApi } = require("twitter-api-v2");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();
const auth = getAuth();

const xClientId = defineSecret("X_CLIENT_ID");
const xClientSecret = defineSecret("X_CLIENT_SECRET");
const xApiKey = defineSecret("X_API_KEY");
const xApiSecret = defineSecret("X_API_SECRET");
const xBearerToken = defineSecret("X_BEARER_TOKEN");
const syncNowKey = defineSecret("SYNC_NOW_KEY");

/** Pay-per-use post-read price (USD). Keep in sync with X console. */
const POST_READ_PRICE_USD = 0.005;

const SITE_URL = "https://mytwitter-feed.web.app";
const OAUTH_CALLBACK_URL = `${SITE_URL}/oauth/callback`;
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

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

function secretsFromEnv() {
  return {
    clientId: xClientId.value(),
    clientSecret: xClientSecret.value(),
    apiKey: xApiKey.value(),
    apiSecret: xApiSecret.value(),
    bearerToken: xBearerToken.value(),
  };
}

const secretOpts = {
  secrets: [xClientId, xClientSecret, xApiKey, xApiSecret, xBearerToken],
  timeoutSeconds: 300,
  memory: "512MiB",
  region: "us-central1",
};

const oauthSecretOpts = {
  secrets: [xClientId, xClientSecret],
  timeoutSeconds: 60,
  memory: "256MiB",
  region: "us-central1",
};

function normalizeHandle(handle) {
  return String(handle || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function getAllowlist() {
  const snap = await db.collection("config").doc("allowlist").get();
  if (!snap.exists) return { handles: [], xUserIds: [] };
  const data = snap.data() || {};
  return {
    handles: (data.handles || []).map(normalizeHandle),
    xUserIds: (data.xUserIds || []).map(String),
  };
}

async function isExistingMember(xUserId) {
  const snap = await db.collection("members").doc(xUserId).get();
  return snap.exists && snap.data()?.enabled !== false;
}

async function isAllowlisted(xUserId, handle) {
  const list = await getAllowlist();
  const h = normalizeHandle(handle);
  return list.xUserIds.includes(String(xUserId)) || list.handles.includes(h);
}

async function consumeInvite(code, xUserId) {
  if (!code) return false;
  const ref = db.collection("invites").doc(String(code));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.active === false) return false;
    if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) return false;
    const used = Number(data.usedCount || 0);
    const max = Number(data.maxUses || 1);
    if (used >= max) return false;
    tx.set(
      ref,
      {
        usedCount: used + 1,
        lastRedeemedBy: xUserId,
        lastRedeemedAt: FieldValue.serverTimestamp(),
        active: used + 1 >= max ? false : data.active !== false,
      },
      { merge: true }
    );
    return true;
  });
}

async function getUserClient(userDoc, secrets) {
  const data = userDoc.data();

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
  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    await db.collection("config").doc("public").set(
      {
        lastRefreshedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  return { users: usersSnap.size, results, usage };
}

async function upsertMemberAndUser({
  xUserId,
  handle,
  name,
  avatar,
  accessToken,
  refreshToken,
  expiresIn,
  role,
}) {
  const memberRef = db.collection("members").doc(xUserId);
  const memberSnap = await memberRef.get();
  const existingRole = memberSnap.exists ? memberSnap.data()?.role : null;
  const resolvedRole = existingRole || role || "member";

  await memberRef.set(
    {
      handle: normalizeHandle(handle),
      name: name || handle,
      avatar: avatar || null,
      role: resolvedRole,
      enabled: true,
      xUserId,
      joinedAt: memberSnap.exists
        ? memberSnap.data()?.joinedAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db
    .collection("users")
    .doc(xUserId)
    .set(
      {
        enabled: true,
        authType: "oauth2",
        accessBlocked: false,
        oauth1: FieldValue.delete(),
        xUserId,
        firebaseUid: xUserId,
        handle: normalizeHandle(handle),
        name: name || handle,
        avatar: avatar || null,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresIn
          ? Timestamp.fromMillis(Date.now() + expiresIn * 1000)
          : null,
        publicFeed: true,
        connectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

// --- Auth endpoints ---

exports.startXAuth = onRequest(oauthSecretOpts, async (req, res) => {
  try {
    const invite = (req.query.invite || "").toString().trim() || null;
    const client = new TwitterApi({
      clientId: xClientId.value(),
      clientSecret: xClientSecret.value(),
    });
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
      OAUTH_CALLBACK_URL,
      {
        scope: ["tweet.read", "users.read", "offline.access"],
      }
    );

    await db
      .collection("oauthSessions")
      .doc(state)
      .set({
        codeVerifier,
        invite,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + OAUTH_SESSION_TTL_MS),
      });

    res.redirect(302, url);
  } catch (err) {
    logger.error("startXAuth failed", err);
    res
      .status(500)
      .send(`Could not start X sign-in: ${escapeHtml(err.message)}`);
  }
});

exports.xOAuthCallback = onRequest(
  { ...oauthSecretOpts, secrets: [xClientId, xClientSecret, xApiKey, xApiSecret, xBearerToken] },
  async (req, res) => {
    const fail = (msg) => {
      const u = new URL(SITE_URL);
      u.searchParams.set("authError", msg);
      res.redirect(302, u.toString());
    };

    try {
      const code = req.query.code;
      const state = req.query.state;
      const oauthError = req.query.error;
      if (oauthError) {
        fail(String(oauthError));
        return;
      }
      if (!code || !state) {
        fail("missing_oauth_params");
        return;
      }

      const sessionRef = db.collection("oauthSessions").doc(String(state));
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) {
        fail("expired_or_invalid_session");
        return;
      }
      const session = sessionSnap.data();
      await sessionRef.delete();

      if (
        session.expiresAt &&
        session.expiresAt.toMillis &&
        session.expiresAt.toMillis() < Date.now()
      ) {
        fail("expired_session");
        return;
      }

      const client = new TwitterApi({
        clientId: xClientId.value(),
        clientSecret: xClientSecret.value(),
      });
      const {
        client: loggedClient,
        accessToken,
        refreshToken,
        expiresIn,
      } = await client.loginWithOAuth2({
        code: String(code),
        codeVerifier: session.codeVerifier,
        redirectUri: OAUTH_CALLBACK_URL,
      });

      const me = await loggedClient.v2.me({
        "user.fields": ["name", "username", "profile_image_url"],
      });
      const xUserId = me.data.id;
      const handle = me.data.username;
      const name = me.data.name || handle;
      const avatar = me.data.profile_image_url
        ? me.data.profile_image_url.replace("_normal", "_bigger")
        : null;

      const alreadyMember = await isExistingMember(xUserId);
      const allowlisted = await isAllowlisted(xUserId, handle);
      let invited = false;
      if (!alreadyMember && !allowlisted && session.invite) {
        invited = await consumeInvite(session.invite, xUserId);
      }

      if (!alreadyMember && !allowlisted && !invited) {
        fail("not_invited");
        return;
      }

      const allowlist = await getAllowlist();
      const isBootstrapAdmin =
        allowlist.handles[0] &&
        normalizeHandle(handle) === allowlist.handles[0];
      const role = isBootstrapAdmin ? "admin" : "member";

      await upsertMemberAndUser({
        xUserId,
        handle,
        name,
        avatar,
        accessToken,
        refreshToken,
        expiresIn,
        role: alreadyMember ? undefined : role,
      });

      // Fire-and-forget first sync for this user.
      const secrets = secretsFromEnv();
      const userDoc = await db.collection("users").doc(xUserId).get();
      syncUser(userDoc, secrets)
        .then(() =>
          db.collection("config").doc("public").set(
            { lastRefreshedAt: FieldValue.serverTimestamp() },
            { merge: true }
          )
        )
        .catch((err) =>
          logger.warn("post-oauth sync failed", { xUserId, error: err.message })
        );

      const customToken = await auth.createCustomToken(xUserId, {
        handle: normalizeHandle(handle),
      });
      const u = new URL(SITE_URL);
      u.searchParams.set("token", customToken);
      res.redirect(302, u.toString());
    } catch (err) {
      logger.error("xOAuthCallback failed", {
        error: err.message,
        data: err.data,
      });
      fail("oauth_failed");
    }
  }
);

exports.createInvite = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required");
    }
    const memberSnap = await db
      .collection("members")
      .doc(request.auth.uid)
      .get();
    if (!memberSnap.exists || memberSnap.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin only");
    }

    const maxUses = Math.min(
      Math.max(Number(request.data?.maxUses || 1), 1),
      50
    );
    const days = Math.min(Math.max(Number(request.data?.days || 14), 1), 90);
    const code = randomToken(9);
    const expiresAt = Timestamp.fromMillis(
      Date.now() + days * 24 * 60 * 60 * 1000
    );

    await db.collection("invites").doc(code).set({
      createdBy: request.auth.uid,
      maxUses,
      usedCount: 0,
      expiresAt,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      code,
      url: `${SITE_URL}/?invite=${code}`,
      maxUses,
      expiresAt: expiresAt.toDate().toISOString(),
    };
  }
);

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

exports.syncNow = onRequest(
  {
    ...secretOpts,
    secrets: [...secretOpts.secrets, syncNowKey],
  },
  async (req, res) => {
    const expected = syncNowKey.value();
    if (!expected || req.query.key !== expected) {
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
  }
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
