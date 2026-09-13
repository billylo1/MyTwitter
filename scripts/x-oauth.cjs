#!/usr/bin/env node
/**
 * One-time X OAuth 2.0 (PKCE) login.
 *
 * Prerequisites:
 *   1. In the X Developer Portal, add callback: http://127.0.0.1:8765/callback
 *   2. Scopes: tweet.read, users.read, follows.read, follows.write, like.read, like.write, offline.access
 *   3. Copy .env.example → .env and fill X_CLIENT_ID / X_CLIENT_SECRET
 *   4. Download a service account JSON for mytwitter-feed and set
 *      GOOGLE_APPLICATION_CREDENTIALS (or place it at ./serviceAccount.json)
 *
 * Usage:
 *   node scripts/x-oauth.mjs
 *
 * Stores tokens at users/{xUserId} so the Cloud Function can poll that feed.
 */

const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const { TwitterApi } = require("twitter-api-v2");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const ROOT = path.resolve(__dirname, "..");
const CALLBACK_URL =
  process.env.X_CALLBACK_URL || "http://localhost:8765/callback";
const PORT = Number(new URL(CALLBACK_URL).port || 8765);
const OAUTH_SCOPES = [
  "tweet.read",
  "users.read",
  "follows.read",
  "follows.write",
  "like.read",
  "like.write",
  "offline.access",
];

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function initAdmin() {
  if (getApps().length) return;
  const raw =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(ROOT, "serviceAccount.json");
  const credPath = path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
  if (!fs.existsSync(credPath)) {
    throw new Error(
      `Missing service account JSON at ${credPath}. Download one from Firebase Console → Project settings → Service accounts.`
    );
  }
  initializeApp({
    credential: cert(JSON.parse(fs.readFileSync(credPath, "utf8"))),
    projectId: "mytwitter-feed",
  });
}

async function main() {
  loadEnv();
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "Set X_CLIENT_ID and X_CLIENT_SECRET in .env (see .env.example)."
    );
    process.exit(1);
  }

  initAdmin();
  const db = getFirestore();

  const client = new TwitterApi({ clientId, clientSecret });
  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
    CALLBACK_URL,
    {
        scope: OAUTH_SCOPES,
    }
  );

  console.log("\nOpen this URL in your browser and authorize the app:\n");
  console.log(url);
  console.log(`\nWaiting for callback on ${CALLBACK_URL} …\n`);

  const { code, returnedState } = await waitForCallback();
  if (returnedState !== state) {
    throw new Error("OAuth state mismatch — try again.");
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
    expiresIn,
  } = await client.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: CALLBACK_URL,
  });

  let me;
  try {
    me = await loggedClient.v2.me({
      "user.fields": ["name", "username", "profile_image_url"],
    });
  } catch (err) {
    const detail = err?.data?.detail || err.message;
    const reason = err?.data?.reason || "";
    console.error("\nToken exchange worked, but X blocked /2/users/me:");
    console.error(detail);
    if (reason === "client-not-enrolled" || /attached to a Project/i.test(detail)) {
      console.error(`
Fix in the Developer Portal (https://developer.x.com/en/portal/projects-and-apps):
  1. Create a Project (or open an existing one)
  2. Add / move this App into that Project
  3. Confirm the Project has Basic or Pay-per-use access
  4. Re-run: npm run oauth
`);
    }
    process.exit(1);
  }
  const xUserId = me.data.id;
  const handle = me.data.username;

  const userRef = db.collection("users").doc(xUserId);
  await userRef.set(
    {
      enabled: true,
      authType: "oauth2",
      accessBlocked: false,
      oauth1: FieldValue.delete(),
      xUserId,
      handle,
      name: me.data.name || handle,
      avatar: me.data.profile_image_url || null,
      accessToken,
      refreshToken,
      tokenExpiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : null,
      publicFeed: true,
      connectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Public config the static page reads (no secrets).
  await db.collection("config").doc("public").set(
    {
      defaultUid: xUserId,
      defaultHandle: handle,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`\nConnected @${handle} (id ${xUserId}).`);
  console.log(`Stored tokens at users/${xUserId}`);
  console.log(`Public feed uid set to ${xUserId}`);
  console.log(
    "\nNext: set Firebase secrets and deploy:\n" +
      "  firebase functions:secrets:set X_CLIENT_ID\n" +
      "  firebase functions:secrets:set X_CLIENT_SECRET\n" +
      "  firebase deploy\n" +
      "  # then hit syncNow once to pull the last 24h of posts\n"
  );
  process.exit(0);
}

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, CALLBACK_URL);
        if (u.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const code = u.searchParams.get("code");
        const returnedState = u.searchParams.get("state");
        const error = u.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Auth failed</h1><p>${error}</p>`);
          server.close();
          reject(new Error(error));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Connected</h1><p>You can close this tab and return to the terminal.</p>"
        );
        server.close();
        resolve({ code, returnedState });
      } catch (err) {
        server.close();
        reject(err);
      }
    });
    // Bind all interfaces so both http://localhost and http://127.0.0.1 work.
    server.listen(PORT, "0.0.0.0");
    server.on("error", reject);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
