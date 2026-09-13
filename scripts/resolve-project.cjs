/**
 * Resolve Firebase project id for local Admin SDK scripts.
 * Prefer FIREBASE_PROJECT_ID, else .firebaserc default.
 */
const fs = require("fs");
const path = require("path");

function resolveFirebaseProjectId(root = path.resolve(__dirname, "..")) {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID.trim();
  }
  const rcPath = path.join(root, ".firebaserc");
  if (!fs.existsSync(rcPath)) {
    throw new Error(
      "Set FIREBASE_PROJECT_ID or copy .firebaserc.example → .firebaserc with your project id."
    );
  }
  const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
  const id = rc?.projects?.default;
  if (!id || id === "your-firebase-project-id") {
    throw new Error(
      "Set projects.default in .firebaserc (or FIREBASE_PROJECT_ID) to your Firebase project id."
    );
  }
  return id;
}

module.exports = { resolveFirebaseProjectId };
