/**
 * Optional Sentry for Cloud Functions.
 * Set SENTRY_DSN in functions/.env.<projectId> (gitignored) to enable.
 * Empty / unset ⇒ no-op (safe for forks).
 */

let initialized = false;
let enabled = false;
/** @type {typeof import("@sentry/node") | null} */
let Sentry = null;

function initSentryFromEnv() {
  if (initialized) return enabled;
  initialized = true;
  const dsn = (process.env.SENTRY_DSN || "").trim();
  if (!dsn) {
    enabled = false;
    return false;
  }
  try {
    // Lazy require so a missing optional install never breaks cold start.
    Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      environment:
        process.env.FUNCTIONS_EMULATOR === "true" ? "emulator" : "production",
      release: process.env.K_REVISION || undefined,
      tracesSampleRate: 0,
    });
    enabled = true;
  } catch (err) {
    console.warn(
      "[sentry] init skipped:",
      err && err.message ? err.message : err
    );
    enabled = false;
  }
  return enabled;
}

/** Expected client / auth failures — do not report. */
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
  if (!initSentryFromEnv() || !Sentry) return;

  try {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined) scope.setExtra(key, value);
      }
      Sentry.captureException(err);
    });
    await Sentry.flush(2000);
  } catch (reportErr) {
    console.warn(
      "[sentry] report failed:",
      reportErr && reportErr.message ? reportErr.message : reportErr
    );
  }
}

module.exports = {
  initSentryFromEnv,
  reportError,
  isExpectedHttpsError,
};
