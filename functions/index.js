/**
 * MyTwitter Cloud Functions — X OAuth login, family membership, timeline sync.
 */

const crypto = require("crypto");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { TwitterApi } = require("twitter-api-v2");
const logger = require("firebase-functions/logger");
const { reportError, initSentryFromEnv } = require("./sentry");

initializeApp();
const db = getFirestore();
const auth = getAuth();
const messaging = getMessaging();

const xClientId = defineSecret("X_CLIENT_ID");
const xClientSecret = defineSecret("X_CLIENT_SECRET");
const xApiKey = defineSecret("X_API_KEY");
const xApiSecret = defineSecret("X_API_SECRET");
const xBearerToken = defineSecret("X_BEARER_TOKEN");
const syncNowKey = defineSecret("SYNC_NOW_KEY");
const firebaseAdminCreds = defineSecret("ADMIN_SDK_CREDENTIALS");
/** Optional — empty default so forks work without Sentry. Set in functions/.env.<projectId>. */
const sentryDsn = defineString("SENTRY_DSN", {
  default: "",
  description: "Optional Sentry DSN for Cloud Functions (leave blank to disable)",
});

/** Resolve optional SENTRY_DSN param (empty for forks) then init. */
function ensureSentry() {
  try {
    const dsn = (sentryDsn.value() || "").trim();
    if (dsn) process.env.SENTRY_DSN = dsn;
  } catch {
    // Param not available in this context — leave process.env as-is.
  }
  return initSentryFromEnv();
}

/** Sign custom tokens with the Admin SDK private key (avoids signBlob IAM on Gen2). */
function getSigningAuth() {
  const name = "token-signer";
  const existing = getApps().find((a) => a.name === name);
  if (existing) return getAuth(existing);
  const raw = firebaseAdminCreds.value();
  const cred = typeof raw === "string" ? JSON.parse(raw) : raw;
  const signerApp = initializeApp({ credential: cert(cred) }, name);
  return getAuth(signerApp);
}

/** Pay-per-use post-read price (USD). Keep in sync with X console. */
const POST_READ_PRICE_USD = 0.005;

/** Public Hosting origin (set via `functions/.env.<projectId>` → SITE_URL=…). */
const siteUrl = defineString("SITE_URL", {
  default: "https://YOUR_PROJECT_ID.web.app",
  description: "Public HTTPS origin of the Firebase Hosting site",
});

function getSiteUrl() {
  return siteUrl.value().replace(/\/$/, "");
}

function getOauthCallbackUrl() {
  return `${getSiteUrl()}/oauth/callback`;
}

const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

const TWEET_FIELDS = [
  "created_at",
  "author_id",
  "attachments",
  "referenced_tweets",
  "entities",
  "note_tweet",
];
const EXPANSIONS = [
  "author_id",
  "attachments.media_keys",
  "referenced_tweets.id",
  "referenced_tweets.id.author_id",
  "referenced_tweets.id.attachments.media_keys",
];
const MEDIA_FIELDS = [
  "url",
  "preview_image_url",
  "type",
  "width",
  "height",
  "duration_ms",
  "alt_text",
  "variants",
];
const USER_FIELDS = [
  "name",
  "username",
  "profile_image_url",
  "description",
  "verified",
  "verified_type",
];
const OAUTH_SCOPES = [
  "tweet.read",
  "users.read",
  "follows.read",
  "follows.write",
  "like.read",
  "like.write",
  "offline.access",
];
const PROFILE_USER_FIELDS = [
  "name",
  "username",
  "description",
  "profile_image_url",
  "verified",
  "verified_type",
  "protected",
  "connection_status",
];

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
  secrets: [
    xClientId,
    xClientSecret,
    xApiKey,
    xApiSecret,
    xBearerToken,
  ],
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

/** Friend/family invite links. Default off when unset. */
async function isInvitesEnabled() {
  const snap = await db.collection("config").doc("public").get();
  return snap.exists === true && snap.data()?.invitesEnabled === true;
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

function tweetTextV2(tweet) {
  // Long-form posts: prefer note_tweet over truncated text.
  return tweet?.note_tweet?.text || tweet?.text || "";
}

function bestMp4Url(variants) {
  if (!Array.isArray(variants)) return null;
  const mp4s = variants.filter(
    (v) => v && v.url && v.content_type === "video/mp4"
  );
  if (!mp4s.length) return null;
  mp4s.sort((a, b) => (Number(b.bit_rate) || 0) - (Number(a.bit_rate) || 0));
  return mp4s[0].url;
}

function mapMediaItemV2(m) {
  const type = m.type || "photo";
  const previewUrl = m.preview_image_url || m.url || null;
  const videoUrl =
    type === "video" || type === "animated_gif" ? bestMp4Url(m.variants) : null;
  return {
    type,
    url: type === "photo" ? m.url || previewUrl : previewUrl,
    previewUrl,
    videoUrl,
    width: m.width || null,
    height: m.height || null,
    alt: m.alt_text || null,
  };
}

function mediaFromV2(tweet, includes) {
  const keys = tweet?.attachments?.media_keys || [];
  const list = includes?.media;
  if (!keys.length || !Array.isArray(list)) return [];
  return keys
    .map((key) => list.find((m) => m.media_key === key))
    .filter(Boolean)
    .map(mapMediaItemV2);
}

function mediaUrlsFromItems(items) {
  return items.map((m) => m.previewUrl || m.url).filter(Boolean);
}

function isXHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return (
    h === "x.com" ||
    h === "twitter.com" ||
    h.endsWith(".x.com") ||
    h.endsWith(".twitter.com") ||
    h === "t.co"
  );
}

function bestUrlImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const ranked = [...images].sort(
    (a, b) =>
      (Number(b.width) || 0) * (Number(b.height) || 0) -
      (Number(a.width) || 0) * (Number(a.height) || 0)
  );
  return ranked[0]?.url || null;
}

/** Open Graph–style card from entities.urls (when X returns title/description/images). */
function linkPreviewFromEntities(tweet) {
  const urls = [
    ...(tweet?.note_tweet?.entities?.urls || []),
    ...(tweet?.entities?.urls || []),
  ];
  if (!urls.length) return null;

  for (const u of urls) {
    const href = u.unwound_url || u.expanded_url || u.url || "";
    if (!href) continue;
    let hostname = "";
    try {
      hostname = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (isXHost(hostname)) continue;

    const title = u.title || null;
    const description = u.description || null;
    const imageUrl = bestUrlImage(u.images);
    if (!title && !description && !imageUrl) continue;

    return {
      url: href,
      tcoUrl: u.url || null,
      expandedUrl: u.expanded_url || null,
      displayUrl: u.display_url || hostname,
      domain: hostname,
      title,
      description,
      imageUrl,
    };
  }
  return null;
}

/** Drop the card URL from body text when a link preview is shown (matches X web). */
function stripPreviewUrlsFromText(text, preview) {
  if (!preview || !text) return text || "";
  let out = String(text);
  const candidates = [
    preview.tcoUrl,
    preview.expandedUrl,
    preview.url,
    preview.displayUrl,
  ].filter(Boolean);
  for (const raw of candidates) {
    const escaped = String(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "");
  }
  // Older posts: preview without tcoUrl — remove leftover t.co short links.
  if (!preview.tcoUrl) {
    out = out.replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, "");
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function looksLikeVideoThumb(url) {
  return (
    typeof url === "string" &&
    /\/(amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//.test(url)
  );
}

function hasPlayableVideo(data) {
  return (
    Array.isArray(data?.media) && data.media.some((m) => m && m.videoUrl)
  );
}

function mightHaveVideo(data) {
  if (data?.mediaCheckedAt) return false;
  if (hasPlayableVideo(data)) return false;
  if (Array.isArray(data?.media)) {
    return data.media.some(
      (m) => m && (m.type === "video" || m.type === "animated_gif")
    );
  }
  return (data?.mediaUrls || []).some(looksLikeVideoThumb);
}

function resolveRetweetSourceV2(tweet, includes) {
  const ref = (tweet.referenced_tweets || []).find((r) => r.type === "retweeted");
  if (!ref?.id || !includes?.tweets?.length) return null;
  return includes.tweets.find((t) => t.id === ref.id) || null;
}

function mapTweetV2(tweet, includes) {
  const retweet = isRetweetV2(tweet);
  const source = retweet ? resolveRetweetSourceV2(tweet, includes) : null;
  const contentTweet = source || tweet;
  const authorId = contentTweet.author_id || tweet.author_id;
  const author =
    includes?.users?.find((u) => u.id === authorId) || null;
  const reposter =
    retweet
      ? includes?.users?.find((u) => u.id === tweet.author_id) || null
      : null;
  // Self-reposts (author bumping their own post) look like normal posts.
  const selfRepost =
    retweet &&
    String(authorId || "") !== "" &&
    String(authorId) === String(tweet.author_id);
  const showAsRepost = retweet && !selfRepost;
  const handle = author?.username || "unknown";
  const statusId = contentTweet.id || tweet.id;
  const media = mediaFromV2(contentTweet, includes);
  const linkPreview =
    media.length > 0 ? null : linkPreviewFromEntities(contentTweet);
  const rawText = tweetTextV2(contentTweet);
  const text = linkPreview
    ? stripPreviewUrlsFromText(rawText, linkPreview)
    : rawText;

  return {
    text,
    authorId: authorId || null,
    authorName: author?.name || "Unknown",
    authorHandle: handle,
    authorAvatar: author?.profile_image_url
      ? author.profile_image_url.replace("_normal", "_bigger")
      : null,
    createdAt: tweet.created_at
      ? Timestamp.fromDate(new Date(tweet.created_at))
      : FieldValue.serverTimestamp(),
    mediaUrls: mediaUrlsFromItems(media),
    media,
    linkPreview,
    url: handle
      ? `https://x.com/${handle}/status/${statusId}`
      : `https://x.com/i/status/${statusId}`,
    isRetweet: showAsRepost,
    repostedById: showAsRepost
      ? reposter?.id || tweet.author_id || null
      : null,
    repostedByHandle: showAsRepost ? reposter?.username || null : null,
    repostedByName: showAsRepost ? reposter?.name || null : null,
    repostedByAvatar:
      showAsRepost && reposter?.profile_image_url
        ? reposter.profile_image_url.replace("_normal", "_bigger")
        : null,
    fetchedAt: FieldValue.serverTimestamp(),
  };
}

function mediaFromV1(tweet) {
  const media =
    tweet.extended_entities?.media || tweet.entities?.media || [];
  return media.map((m) => {
    const type = m.type || "photo";
    const previewUrl = m.media_url_https || m.media_url || null;
    const videoUrl =
      type === "video" || type === "animated_gif"
        ? bestMp4Url(m.video_info?.variants)
        : null;
    return {
      type,
      url: previewUrl,
      previewUrl,
      videoUrl,
      width: m.sizes?.large?.w || m.sizes?.medium?.w || null,
      height: m.sizes?.large?.h || m.sizes?.medium?.h || null,
      alt: m.ext_alt_text || null,
    };
  });
}

function mapTweetV1(tweet) {
  const source = tweet.retweeted_status || null;
  const content = source || tweet;
  const user = content.user || tweet.user || {};
  const handle = user.screen_name || "unknown";
  const reposter = source ? tweet.user : null;
  const selfRepost =
    Boolean(source) &&
    String(user.id_str || "") !== "" &&
    String(user.id_str) === String(tweet.user?.id_str || "");
  const showAsRepost = Boolean(source) && !selfRepost;
  const media = mediaFromV1(content);
  const linkPreview =
    media.length > 0 ? null : linkPreviewFromEntities(content);
  const rawText = content.full_text || content.text || "";
  const text = linkPreview
    ? stripPreviewUrlsFromText(rawText, linkPreview)
    : rawText;
  return {
    text,
    authorId: user.id_str || null,
    authorName: user.name || "Unknown",
    authorHandle: handle,
    authorAvatar: user.profile_image_url_https
      ? user.profile_image_url_https.replace("_normal", "_bigger")
      : null,
    createdAt: tweet.created_at
      ? Timestamp.fromDate(new Date(tweet.created_at))
      : FieldValue.serverTimestamp(),
    mediaUrls: mediaUrlsFromItems(media),
    media,
    linkPreview,
    url: `https://x.com/${handle}/status/${content.id_str || tweet.id_str}`,
    isRetweet: showAsRepost,
    repostedById: showAsRepost ? reposter?.id_str || null : null,
    repostedByHandle: showAsRepost ? reposter?.screen_name || null : null,
    repostedByName: showAsRepost ? reposter?.name || null : null,
    repostedByAvatar:
      showAsRepost && reposter?.profile_image_url_https
        ? reposter.profile_image_url_https.replace("_normal", "_bigger")
        : null,
    fetchedAt: FieldValue.serverTimestamp(),
  };
}

async function syncViaV2(client, userDoc, sinceId) {
  const params = {
    exclude: ["replies", "retweets"],
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
  const notifyFavorites = Boolean(sinceId);
  const favoriteIds = notifyFavorites
    ? await loadFavoriteIds(userDoc.id)
    : new Set();

  for (let page = 0; page < MAX_PAGES; page++) {
    const tweets = paginator.tweets || [];
    const includes = paginator.includes || {};

    for (const user of includes.users || []) {
      await authorsCol.doc(user.id).set(
        {
          name: user.name,
          username: user.username,
          profileImageUrl: user.profile_image_url || null,
          description: user.description || "",
          verified: Boolean(
            user.verified ||
              (user.verified_type && user.verified_type !== "none")
          ),
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
      const mapped = mapTweetV2(tweet, includes);
      await writePostMaybeNotify(
        userDoc.id,
        postsCol,
        tweet.id,
        mapped,
        favoriteIds,
        notifyFavorites
      );
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
    include_rts: false,
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
  const notifyFavorites = Boolean(sinceId);
  const favoriteIds = notifyFavorites
    ? await loadFavoriteIds(userDoc.id)
    : new Set();

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
    const mapped = mapTweetV1(tweet);
    await writePostMaybeNotify(
      userDoc.id,
      postsCol,
      tweet.id_str,
      mapped,
      favoriteIds,
      notifyFavorites
    );
    written += 1;
  }

  return { fetched, written, newestId, api: "v1" };
}

async function loadFavoriteIds(uid) {
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("favorites")
    .get();
  return new Set(snap.docs.map((d) => d.id));
}

async function writePostMaybeNotify(
  uid,
  postsCol,
  tweetId,
  mapped,
  favoriteIds,
  notifyFavorites
) {
  const ref = postsCol.doc(String(tweetId));
  const existing = await ref.get();
  const isNew = !existing.exists;
  await ref.set(mapped, { merge: true });
  if (!notifyFavorites || !isNew || !favoriteIds.size) return;
  const authorId = mapped.authorId ? String(mapped.authorId) : "";
  const repostedById = mapped.repostedById ? String(mapped.repostedById) : "";
  if (!favoriteIds.has(authorId) && !favoriteIds.has(repostedById)) return;
  try {
    await notifyFavoritePost(uid, String(tweetId), mapped);
  } catch (err) {
    logger.warn("favorite push failed", {
      uid,
      tweetId,
      error: err.message,
    });
  }
}

async function notifyFavoritePost(uid, tweetId, mapped) {
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("devices")
    .get();
  const tokens = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    if (data.enabled === false) continue;
    if (data.token) tokens.push(String(data.token));
  }
  if (!tokens.length) {
    logger.info("favorite push skipped; no devices", { uid, tweetId });
    return;
  }

  const handle =
    mapped.repostedByHandle || mapped.authorHandle || "someone";
  const title = `@${handle} posted`;
  const body = String(mapped.text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  logger.info("favorite push send", {
    uid,
    tweetId,
    handle,
    tokenCount: tokens.length,
  });

  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body: body || "New post from a favorited account" },
    data: {
      tweetId: String(tweetId),
      url: mapped.url ? String(mapped.url) : "",
    },
    android: {
      priority: "high",
      notification: {
        channelId: "favorites",
        priority: "high",
      },
    },
    apns: {
      headers: {
        "apns-priority": "10",
      },
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
  });
  if (res.failureCount) {
    logger.warn("FCM partial failures", {
      uid,
      failureCount: res.failureCount,
      successCount: res.successCount,
      errors: res.responses
        .filter((r) => !r.success)
        .map((r) => r.error?.message || String(r.error)),
    });
  } else {
    logger.info("favorite push ok", { uid, tweetId, successCount: res.successCount });
  }
}

function extractStatusIdFromUrl(raw) {
  try {
    const u = new URL(String(raw));
    const match = (u.pathname || "").match(
      /\/(?:i\/)?(?:web\/)?status(?:es)?\/(\d+)/i
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function followRedirects(startUrl, maxHops = 8) {
  let current = String(startUrl);
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "MyTwitterBot/1.0",
        Accept: "text/html",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }
    return res.url || current;
  }
  return current;
}

function serializePostForClient(tweetId, mapped) {
  const created =
    mapped.createdAt?.toDate?.() ||
    (mapped.createdAt instanceof Date ? mapped.createdAt : null);
  return {
    id: String(tweetId),
    text: mapped.text || "",
    authorId: mapped.authorId || null,
    authorName: mapped.authorName || null,
    authorHandle: mapped.authorHandle || null,
    authorAvatar: mapped.authorAvatar || null,
    createdAt: created ? created.toISOString() : null,
    media: mapped.media || [],
    mediaUrls: mapped.mediaUrls || [],
    linkPreview: mapped.linkPreview || null,
    url: mapped.url || `https://x.com/i/status/${tweetId}`,
    isRetweet: Boolean(mapped.isRetweet),
    repostedById: mapped.repostedById || null,
    repostedByHandle: mapped.repostedByHandle || null,
    repostedByName: mapped.repostedByName || null,
    repostedByAvatar: mapped.repostedByAvatar || null,
  };
}

async function backfillVideoMedia(client, userDoc) {
  const snap = await userDoc.ref
    .collection("posts")
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  const needIds = [];
  for (const docSnap of snap.docs) {
    if (mightHaveVideo(docSnap.data())) needIds.push(docSnap.id);
  }
  if (!needIds.length) return 0;

  const res = await client.v2.tweets(needIds, {
    "tweet.fields": TWEET_FIELDS,
    expansions: EXPANSIONS,
    "media.fields": MEDIA_FIELDS,
    "user.fields": USER_FIELDS,
  });
  const tweets = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  const includes = res.includes || {};
  const found = new Set(tweets.map((t) => t.id));
  const postsCol = userDoc.ref.collection("posts");
  const checkedAt = FieldValue.serverTimestamp();
  let updated = 0;

  for (const tweet of tweets) {
    const mapped = mapTweetV2(tweet, includes);
    await postsCol.doc(tweet.id).set(
      {
        media: mapped.media,
        mediaUrls: mapped.mediaUrls,
        mediaCheckedAt: checkedAt,
      },
      { merge: true }
    );
    updated += 1;
  }

  for (const id of needIds) {
    if (found.has(id)) continue;
    await postsCol.doc(id).set({ mediaCheckedAt: checkedAt }, { merge: true });
  }

  return updated;
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

  let videosBackfilled = 0;
  try {
    videosBackfilled = await backfillVideoMedia(client, userDoc);
  } catch (err) {
    logger.warn("video media backfill failed", { uid, error: err.message });
  }

  await syncRef.set(
    {
      sinceId: result.newestId || sinceId || null,
      lastSyncAt: FieldValue.serverTimestamp(),
      lastFetched: result.fetched,
      lastWritten: result.written,
      lastApi: result.api,
      lastVideosBackfilled: videosBackfilled,
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

  return { ...result, videosBackfilled };
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
      await reportError(err, { fn: "syncUser", uid: userDoc.id, detail });
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
  ensureSentry();
  try {
    const invite = (req.query.invite || "").toString().trim() || null;
    const clientHint = (req.query.client || "").toString().trim().toLowerCase() || null;
    const client = new TwitterApi({
      clientId: xClientId.value(),
      clientSecret: xClientSecret.value(),
    });
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
      getOauthCallbackUrl(),
      {
        scope: OAUTH_SCOPES,
      }
    );

    await db
      .collection("oauthSessions")
      .doc(state)
      .set({
        codeVerifier,
        invite,
        client: clientHint,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + OAUTH_SESSION_TTL_MS),
      });

    res.redirect(302, url);
  } catch (err) {
    logger.error("startXAuth failed", err);
    await reportError(err, { fn: "startXAuth" });
    res
      .status(500)
      .send(`Could not start X sign-in: ${escapeHtml(err.message)}`);
  }
});

exports.xOAuthCallback = onRequest(
  {
    ...oauthSecretOpts,
    secrets: [
      xClientId,
      xClientSecret,
      xApiKey,
      xApiSecret,
      xBearerToken,
      firebaseAdminCreds,
    ],
  },
  async (req, res) => {
    ensureSentry();
    let oauthClientHint = null;

    const fail = (msg) => {
      if (oauthClientHint === "android" || oauthClientHint === "ios") {
        const u = new URL("mytwitter://auth");
        u.searchParams.set("authError", msg);
        res.redirect(302, u.toString());
        return;
      }
      const u = new URL(getSiteUrl());
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
      oauthClientHint = (session?.client || "").toString().toLowerCase() || null;
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
        redirectUri: getOauthCallbackUrl(),
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
      if (
        !alreadyMember &&
        !allowlisted &&
        session.invite &&
        (await isInvitesEnabled())
      ) {
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

      const customToken = await getSigningAuth().createCustomToken(xUserId, {
        handle: normalizeHandle(handle),
      });
      if (oauthClientHint === "android" || oauthClientHint === "ios") {
        const u = new URL("mytwitter://auth");
        u.searchParams.set("token", customToken);
        res.redirect(302, u.toString());
        return;
      }
      const u = new URL(getSiteUrl());
      u.searchParams.set("token", customToken);
      res.redirect(302, u.toString());
    } catch (err) {
      logger.error("xOAuthCallback failed", {
        error: err.message,
        data: err.data,
      });
      await reportError(err, { fn: "xOAuthCallback" });
      fail("oauth_failed");
    }
  }
);

exports.createInvite = onCall(
  { region: "us-central1" },
  withSentryCall("createInvite", async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required");
    }
    if (!(await isInvitesEnabled())) {
      throw new HttpsError(
        "failed-precondition",
        "Invites are disabled. Set config/public.invitesEnabled to true."
      );
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
      url: `${getSiteUrl()}/?invite=${code}`,
      maxUses,
      expiresAt: expiresAt.toDate().toISOString(),
    };
  })
);

/** Ensure the signed-in member has an rssToken; return the secret feed URL. */
exports.getRssFeedUrl = onCall(
  { region: "us-central1" },
  withSentryCall("getRssFeedUrl", async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required");
    }
    const uid = request.auth.uid;
    const memberSnap = await db.collection("members").doc(uid).get();
    if (!memberSnap.exists || memberSnap.data()?.enabled === false) {
      throw new HttpsError("permission-denied", "Not a member");
    }

    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();
    let token =
      userDoc.exists && typeof userDoc.data()?.rssToken === "string"
        ? userDoc.data().rssToken.trim()
        : "";
    if (!token || token.length < 16) {
      token = randomToken(24);
      await userRef.set(
        {
          rssToken: token,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return { url: `${getSiteUrl()}/feed.xml?token=${encodeURIComponent(token)}` };
  })
);

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cdataSafe(value) {
  return String(value ?? "").replaceAll("]]>", "]]&gt;");
}

function truncateRssTitle(text, max = 100) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function buildRssItemXml(tweetId, post) {
  const handle = post.authorHandle || "unknown";
  const text = post.text || "";
  const url =
    post.url ||
    `https://x.com/${handle}/status/${tweetId}`;
  const created =
    post.createdAt && typeof post.createdAt.toDate === "function"
      ? post.createdAt.toDate()
      : new Date();

  let title;
  if (post.isRetweet && post.repostedByHandle) {
    title = `@${post.repostedByHandle} reposted @${handle}: ${truncateRssTitle(text, 80)}`;
  } else {
    title = `@${handle}: ${truncateRssTitle(text, 100)}`;
  }

  const descParts = [`<p>${escapeXml(text).replaceAll("\n", "<br/>")}</p>`];
  const media = Array.isArray(post.media) ? post.media : [];
  const firstMedia = media[0];
  const imgUrl =
    firstMedia?.previewUrl ||
    firstMedia?.url ||
    (Array.isArray(post.mediaUrls) ? post.mediaUrls[0] : null);
  if (imgUrl) {
    descParts.push(
      `<p><img src="${escapeXml(imgUrl)}" alt="" /></p>`
    );
  } else if (post.linkPreview?.url) {
    const lp = post.linkPreview;
    const bits = [];
    if (lp.title) bits.push(`<strong>${escapeXml(lp.title)}</strong>`);
    if (lp.description) bits.push(escapeXml(lp.description));
    if (lp.imageUrl) {
      bits.push(`<br/><img src="${escapeXml(lp.imageUrl)}" alt="" />`);
    }
    bits.push(
      `<br/><a href="${escapeXml(lp.url)}">${escapeXml(lp.domain || lp.url)}</a>`
    );
    descParts.push(`<p>${bits.join("<br/>")}</p>`);
  }

  const description = cdataSafe(descParts.join("\n"));
  return `<item>
<title>${escapeXml(title)}</title>
<link>${escapeXml(url)}</link>
<guid isPermaLink="true">${escapeXml(url)}</guid>
<pubDate>${created.toUTCString()}</pubDate>
<description><![CDATA[${description}]]></description>
</item>`;
}

/** Secret-token RSS 2.0 feed of the member's following timeline. */
exports.feedRss = onRequest(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (req, res) => {
    ensureSentry();
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.status(405).set("Allow", "GET, HEAD").send("Method Not Allowed");
        return;
      }

      const token = String(req.query.token || "").trim();
      if (!token || token.length < 16) {
        res.status(404).send("Not found");
        return;
      }

      const userSnap = await db
        .collection("users")
        .where("rssToken", "==", token)
        .limit(1)
        .get();
      if (userSnap.empty) {
        res.status(404).send("Not found");
        return;
      }

      const userDoc = userSnap.docs[0];
      const uid = userDoc.id;
      const userData = userDoc.data() || {};
      if (userData.enabled === false) {
        res.status(404).send("Not found");
        return;
      }

      const memberSnap = await db.collection("members").doc(uid).get();
      if (!memberSnap.exists || memberSnap.data()?.enabled === false) {
        res.status(404).send("Not found");
        return;
      }

      const handle =
        memberSnap.data()?.handle || userData.handle || uid;
      const postsSnap = await db
        .collection("users")
        .doc(uid)
        .collection("posts")
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();

      const items = postsSnap.docs
        .map((d) => buildRssItemXml(d.id, d.data() || {}))
        .join("\n");

      const site = getSiteUrl();
      const channelTitle = `MyTwitter — @${handle}`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(channelTitle)}</title>
<link>${escapeXml(site)}</link>
<description>${escapeXml("Private following feed (secret URL). Newest first.")}</description>
${items}
</channel>
</rss>`;

      res.set({
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      });
      if (req.method === "HEAD") {
        res.status(200).end();
        return;
      }
      res.status(200).send(xml);
    } catch (err) {
      logger.error("feedRss failed", err);
      await reportError(err, { fn: "feedRss" });
      res.status(500).send("Internal error");
    }
  }
);

function mapAuthorCard(user, viewerId) {
  const connections = Array.isArray(user.connection_status)
    ? user.connection_status
    : [];
  const avatar = user.profile_image_url
    ? String(user.profile_image_url).replace("_normal", "_bigger")
    : null;
  return {
    id: user.id,
    name: user.name || user.username,
    handle: user.username,
    avatar,
    description: user.description || "",
    verified: Boolean(
      user.verified || (user.verified_type && user.verified_type !== "none")
    ),
    protected: Boolean(user.protected),
    following: connections.includes("following"),
    isSelf: String(user.id) === String(viewerId),
  };
}

function throwXError(err, reconnectMessage) {
  const detail =
    err?.data?.detail || err?.data?.title || err?.message || "X API error";
  const code = Number(err?.code) || 0;
  logger.warn("X API error", { code, detail, data: err?.data });
  if (
    code === 401 ||
    code === 403 ||
    /scope|unauthorized|forbidden|not permitted/i.test(String(detail))
  ) {
    throw new HttpsError(
      "failed-precondition",
      reconnectMessage ||
        "Sign out and sign in again to reconnect X permissions."
    );
  }
  // Fire-and-forget report; HttpsError throw continues synchronously.
  void reportError(err instanceof Error ? err : new Error(String(detail)), {
    fn: "xApi",
    code,
    detail,
  });
  throw new HttpsError("internal", String(detail));
}

/** Wrap an onCall handler so unexpected throws are sent to Sentry. */
function withSentryCall(name, handler) {
  return async (request) => {
    ensureSentry();
    try {
      return await handler(request);
    } catch (err) {
      await reportError(err, { fn: name });
      throw err;
    }
  };
}

async function callerClient(uid) {
  const memberSnap = await db.collection("members").doc(uid).get();
  if (!memberSnap.exists || memberSnap.data()?.enabled === false) {
    throw new HttpsError("permission-denied", "Not a member");
  }
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Sign out and sign in again to reconnect X."
    );
  }
  try {
    return await getUserClient(userDoc, secretsFromEnv());
  } catch (err) {
    logger.warn("callerClient failed", { uid, error: err.message });
    throw new HttpsError(
      "failed-precondition",
      "Sign out and sign in again to reconnect X."
    );
  }
}

async function lookupAuthor(client, { userId, handle }) {
  const opts = { "user.fields": PROFILE_USER_FIELDS };
  try {
    if (userId) {
      const res = await client.v2.user(String(userId), opts);
      return res?.data || null;
    }
    const username = normalizeHandle(handle);
    if (!username) return null;
    const res = await client.v2.userByUsername(username, opts);
    return res?.data || null;
  } catch (err) {
    throwXError(err);
  }
  return null;
}

const followFnOpts = {
  region: "us-central1",
  secrets: [xClientId, xClientSecret, xApiKey, xApiSecret],
  timeoutSeconds: 30,
  memory: "256MiB",
};

exports.getAuthorCard = onCall(
  followFnOpts,
  withSentryCall("getAuthorCard", async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const userId = String(request.data?.userId || "").trim();
  const handle = String(request.data?.handle || "").trim();
  if (!userId && !handle) {
    throw new HttpsError("invalid-argument", "userId or handle required");
  }

  const { client, xUserId } = await callerClient(request.auth.uid);
  const user = await lookupAuthor(client, { userId, handle });
  if (!user) {
    throw new HttpsError("not-found", "Account not found");
  }
  return mapAuthorCard(user, xUserId);
  })
);

exports.setFollowing = onCall(
  followFnOpts,
  withSentryCall("setFollowing", async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const targetId = String(request.data?.userId || "").trim();
  const follow = request.data?.follow !== false;
  if (!targetId) {
    throw new HttpsError("invalid-argument", "userId required");
  }

  const { client, xUserId } = await callerClient(request.auth.uid);
  if (String(targetId) === String(xUserId)) {
    throw new HttpsError("invalid-argument", "You already follow yourself.");
  }

  try {
    if (follow) await client.v2.follow(xUserId, targetId);
    else await client.v2.unfollow(xUserId, targetId);
  } catch (err) {
    throwXError(
      err,
      "Sign out and sign in again to follow people from MyTwitter."
    );
  }

  return { userId: targetId, following: follow };
  })
);

exports.setLiked = onCall(
  followFnOpts,
  withSentryCall("setLiked", async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const tweetId = String(request.data?.tweetId || "").trim();
  const like = request.data?.like !== false;
  if (!tweetId) {
    throw new HttpsError("invalid-argument", "tweetId required");
  }

  const { client, xUserId } = await callerClient(request.auth.uid);
  const likeRef = db
    .collection("users")
    .doc(request.auth.uid)
    .collection("likes")
    .doc(tweetId);

  try {
    if (like) {
      await client.v2.like(xUserId, tweetId);
      await likeRef.set({
        likedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await client.v2.unlike(xUserId, tweetId);
      await likeRef.delete();
    }
  } catch (err) {
    throwXError(
      err,
      "Sign out and sign in again to like posts from MyTwitter."
    );
  }

  return { tweetId, liked: like };
  })
);
exports.resolveTweetUrl = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  withSentryCall("resolveTweetUrl", async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required");
    }
    const memberSnap = await db
      .collection("members")
      .doc(request.auth.uid)
      .get();
    if (!memberSnap.exists || memberSnap.data()?.enabled === false) {
      throw new HttpsError("permission-denied", "Not a member");
    }

    const raw = String(request.data?.url || "").trim();
    if (!raw) {
      throw new HttpsError("invalid-argument", "url required");
    }

    let candidate = raw;
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      if (host === "t.co") {
        candidate = await followRedirects(raw);
      }
    } catch {
      throw new HttpsError("invalid-argument", "Invalid url");
    }

    const tweetId = extractStatusIdFromUrl(candidate);
    if (!tweetId) {
      throw new HttpsError(
        "not-found",
        "Could not find a tweet id in that link."
      );
    }
    return { tweetId, resolvedUrl: candidate };
  })
);

exports.getTweet = onCall(
  followFnOpts,
  withSentryCall("getTweet", async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const tweetId = String(request.data?.tweetId || "").trim();
  if (!/^\d+$/.test(tweetId)) {
    throw new HttpsError("invalid-argument", "tweetId required");
  }

  const postRef = db
    .collection("users")
    .doc(request.auth.uid)
    .collection("posts")
    .doc(tweetId);
  const existing = await postRef.get();
  if (existing.exists) {
    return { post: serializePostForClient(tweetId, existing.data() || {}) };
  }

  const { client } = await callerClient(request.auth.uid);
  try {
    const res = await client.v2.singleTweet(tweetId, {
      "tweet.fields": TWEET_FIELDS,
      expansions: EXPANSIONS,
      "media.fields": MEDIA_FIELDS,
      "user.fields": USER_FIELDS,
    });
    const tweet = res?.data;
    if (!tweet) {
      throw new HttpsError("not-found", "Tweet not found");
    }
    const includes = res.includes || {};
    const mapped = mapTweetV2(tweet, includes);
    // Do not write into users/{uid}/posts — that collection is the following
    // timeline. Lookup write-through was inserting unrelated authors into the
    // live feed and jumping the scroll when t.co / deep links were opened.
    return { post: serializePostForClient(tweetId, mapped) };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throwXError(err, "Sign out and sign in again to load posts.");
  }
  })
);

exports.registerDevice = onCall(
  { region: "us-central1" },
  withSentryCall("registerDevice", async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required");
    }
    const memberSnap = await db
      .collection("members")
      .doc(request.auth.uid)
      .get();
    if (!memberSnap.exists || memberSnap.data()?.enabled === false) {
      throw new HttpsError("permission-denied", "Not a member");
    }

    const token = String(request.data?.token || "").trim();
    const platform = String(request.data?.platform || "android")
      .trim()
      .toLowerCase();
    if (!token || token.length < 20) {
      throw new HttpsError("invalid-argument", "token required");
    }

    const tokenId = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 40);
    await db
      .collection("users")
      .doc(request.auth.uid)
      .collection("devices")
      .doc(tokenId)
      .set(
        {
          token,
          platform: platform || "android",
          enabled: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return { ok: true };
  })
);

const MANUAL_SYNC_COOLDOWN_MS = 60_000;

exports.syncMyTimeline = onCall(secretOpts, async (request) => {
  ensureSentry();
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const uid = request.auth.uid;
  const memberSnap = await db.collection("members").doc(uid).get();
  if (!memberSnap.exists || memberSnap.data()?.enabled === false) {
    throw new HttpsError("permission-denied", "Not a member");
  }

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists || userDoc.data()?.enabled === false) {
    throw new HttpsError("failed-precondition", "User sync not enabled");
  }

  const syncRef = userRef.collection("sync").doc("state");
  const syncSnap = await syncRef.get();
  const lastManual = syncSnap.exists ? syncSnap.data()?.lastManualSyncAt : null;
  const lastMs =
    lastManual && typeof lastManual.toMillis === "function"
      ? lastManual.toMillis()
      : 0;
  if (lastMs && Date.now() - lastMs < MANUAL_SYNC_COOLDOWN_MS) {
    const waitSec = Math.ceil(
      (MANUAL_SYNC_COOLDOWN_MS - (Date.now() - lastMs)) / 1000
    );
    throw new HttpsError(
      "resource-exhausted",
      `Wait ${waitSec}s before syncing again`
    );
  }

  try {
    const stats = await syncUser(userDoc, secretsFromEnv());
    await syncRef.set(
      { lastManualSyncAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await db.collection("config").doc("public").set(
      { lastRefreshedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    logger.info("syncMyTimeline done", { uid, ...stats });
    return {
      ok: true,
      fetched: stats.fetched ?? 0,
      written: stats.written ?? 0,
      newestId: stats.newestId || null,
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const detail =
      err.data?.detail ||
      err.data?.errors?.[0]?.message ||
      err.message ||
      String(err);
    logger.error("syncMyTimeline failed", { uid, error: detail });
    await reportError(err, { fn: "syncMyTimeline", uid, detail });
    throw new HttpsError("internal", String(detail));
  }
});

exports.syncTimeline = onSchedule(
  {
    schedule: "every 10 minutes",
    ...secretOpts,
  },
  async () => {
    ensureSentry();
    try {
      const summary = await runSyncAll(secretsFromEnv());
      logger.info("syncTimeline done", summary);
    } catch (err) {
      logger.error("syncTimeline failed", err);
      await reportError(err, { fn: "syncTimeline" });
      throw err;
    }
  }
);

exports.syncNow = onRequest(
  {
    ...secretOpts,
    secrets: [...secretOpts.secrets, syncNowKey],
  },
  async (req, res) => {
    ensureSentry();
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
      await reportError(err, { fn: "syncNow" });
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
