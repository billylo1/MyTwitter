#!/usr/bin/env node
/**
 * OAuth 1.0a PIN login — prints an authorize URL, then exchanges the PIN
 * for access tokens and stores them in Firestore for the poller.
 *
 * Usage:
 *   node scripts/x-oauth1-pin.cjs
 *   # open URL, authorize, paste the PIN when prompted
 */

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { TwitterApi } = require("twitter-api-v2");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const ROOT = path.resolve(__dirname, "..");

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
    if (!process.env[key]) process.env[key] = val;
  }
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  loadEnv();
  const appKey = process.env.X_API_KEY || process.env.X_CONSUMER_KEY;
  const appSecret = process.env.X_API_SECRET || process.env.X_CONSUMER_SECRET;
  if (!appKey || !appSecret) {
    console.error("Set X_API_KEY and X_API_SECRET in .env");
    process.exit(1);
  }

  const client = new TwitterApi({ appKey, appSecret });
  const { url, oauth_token, oauth_token_secret } =
    await client.generateAuthLink("oob");

  console.log("\nOpen this URL, authorize the app, then copy the PIN:\n");
  console.log(url);
  console.log("");

  const pin = await ask("PIN: ");
  if (!pin) {
    console.error("No PIN entered");
    process.exit(1);
  }

  const loginClient = new TwitterApi({
    appKey,
    appSecret,
    accessToken: oauth_token,
    accessSecret: oauth_token_secret,
  });
  const {
    client: logged,
    accessToken,
    accessSecret,
    screenName,
    userId,
  } = await loginClient.login(pin);

  let name = screenName;
  let avatar = null;
  try {
    const me = await logged.v2.me({
      "user.fields": ["name", "username", "profile_image_url"],
    });
    name = me.data.name || screenName;
    avatar = me.data.profile_image_url || null;
    console.log("v2.me OK", me.data.id, me.data.username);
  } catch (err) {
    console.warn(
      "v2.me failed (will still store oauth1 tokens):",
      err.data?.reason || err.message
    );
  }

  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(ROOT, "serviceAccount.json");
  const abs = path.isAbsolute(credPath)
    ? credPath
    : path.resolve(ROOT, credPath);
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(fs.readFileSync(abs, "utf8"))),
      projectId: "mytwitter-feed",
    });
  }
  const db = getFirestore();
  const xUserId = String(userId);

  await db.collection("users").doc(xUserId).set(
    {
      enabled: true,
      xUserId,
      handle: screenName,
      name,
      avatar,
      authType: "oauth1",
      oauth1: {
        appKey,
        appSecret,
        accessToken,
        accessSecret,
      },
      // clear oauth2 fields so poller prefers oauth1
      accessToken: FieldValue.delete(),
      refreshToken: FieldValue.delete(),
      publicFeed: true,
      connectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection("config").doc("public").set(
    {
      defaultUid: xUserId,
      defaultHandle: screenName,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`\nConnected @${screenName} (id ${xUserId}) via OAuth 1.0a`);
  console.log(`Stored at users/${xUserId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err.data || err);
  process.exit(1);
});
