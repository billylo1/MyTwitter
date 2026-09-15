/**
 * Sentry for Cloud Functions. DSN from Secret Manager (SENTRY_DSN) —
 * never hardcode. No-ops when the secret is unset.
 */

const Sentry = require("@sentry/node");

let initialized = false;

function initSentryFromEnv() {
  if (initialized) return Boolean(process.env.SENTRY_DSN);
  initialized = true;
  const dsn = (process.env.SENTRY_DSN || "").trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment:
      process.env.FUNCTIONS_EMULATOR === "true" ? "emulator" : "production",
    // Cloud Run revision when deployed (Gen2).
    release: process.env.K_REVISION || undefined,
    tracesSampleRate: 0,
  });
  return true;
}

/** Expected client / auth failures — do not page on these. */
function isExpectedHttpsError(err) {
  if (!err || typeof err.code !== "string") return false;
  const code = err.code.replace(/^functions\//, "");
  return [
    "ok",
    "cancelled",
    "invalid-argument",
    "not-found",
    "already-exists",
    "permission-denied",
    "unauthenticated",
    "resource-exhausted",
    "failed-precondition",
    "aborted",
    "out-of-range",
  ].includes(code);
}

/**
 * Capture an unexpected exception and flush before the instance freezes.
 * @param {unknown} err
 * @param {Record<string, unknown>} [context]
 */
async function reportError(err, context = {}) {
  if (!err) return;
  if (isExpectedHttpsError(err)) return;
  if (!initSentryFromEnv()) return;

  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) scope.setExtra(key, value);
    }
    Sentry.captureException(err);
  });
  await Sentry.flush(2000);
}

module.exports = {
  Sentry,
  initSentryFromEnv,
  reportError,
  isExpectedHttpsError,
};
