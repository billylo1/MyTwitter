#!/usr/bin/env node
/**
 * Bootstrap friends-and-family access:
 *   - config/allowlist.handles (default: billylo)
 *   - members/{xUserId} admin for existing connected user
 *
 * Usage:
 *   node scripts/bootstrap-family.cjs
 *   ADMIN_HANDLE=billylo EXTRA_HANDLES=alice,bob node scripts/bootstrap-family.cjs
 */

const fs = require("fs");
const path = require("path");
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function normalizeHandle(handle) {
  return String(handle || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

async function main() {
  loadEnv();
  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(ROOT, "serviceAccount.json");
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(fs.readFileSync(credPath, "utf8"))),
      projectId: "mytwitter-feed",
    });
  }
  const db = getFirestore();

  const adminHandle = normalizeHandle(process.env.ADMIN_HANDLE || "billylo");
  const extra = String(process.env.EXTRA_HANDLES || "")
    .split(",")
    .map(normalizeHandle)
    .filter(Boolean);
  const handles = [...new Set([adminHandle, ...extra])];

  await db.collection("config").doc("allowlist").set(
    {
      handles,
      xUserIds: [],
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log("Allowlist handles:", handles.join(", "));

  const usersSnap = await db.collection("users").get();
  let adminUid = process.env.ADMIN_X_USER_ID || null;
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const handle = normalizeHandle(data.handle);
    if (!adminUid && handle === adminHandle) adminUid = doc.id;
  }

  if (!adminUid && usersSnap.size === 1) {
    adminUid = usersSnap.docs[0].id;
  }

  if (adminUid) {
    const userDoc = await db.collection("users").doc(adminUid).get();
    const data = userDoc.exists ? userDoc.data() : {};
    await db
      .collection("members")
      .doc(adminUid)
      .set(
        {
          handle: normalizeHandle(data.handle || adminHandle),
          name: data.name || data.handle || adminHandle,
          avatar: data.avatar || null,
          role: "admin",
          enabled: true,
          xUserId: adminUid,
          joinedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    await db.collection("users").doc(adminUid).set(
      {
        enabled: true,
        firebaseUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`Admin member: @${data.handle || adminHandle} (${adminUid})`);
  } else {
    console.log(
      "No existing users/{uid} found for admin. Sign in with X after deploy to create membership (allowlisted handle becomes admin if first on list)."
    );
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
