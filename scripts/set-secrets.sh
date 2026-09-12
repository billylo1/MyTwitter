#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.env"
printf '%s' "$X_CLIENT_ID" | npx -y firebase-tools@latest functions:secrets:set X_CLIENT_ID --project mytwitter-feed --data-file=-
printf '%s' "$X_CLIENT_SECRET" | npx -y firebase-tools@latest functions:secrets:set X_CLIENT_SECRET --project mytwitter-feed --data-file=-
printf '%s' "$X_API_KEY" | npx -y firebase-tools@latest functions:secrets:set X_API_KEY --project mytwitter-feed --data-file=-
printf '%s' "$X_API_SECRET" | npx -y firebase-tools@latest functions:secrets:set X_API_SECRET --project mytwitter-feed --data-file=-
printf '%s' "$X_BEARER_TOKEN" | npx -y firebase-tools@latest functions:secrets:set X_BEARER_TOKEN --project mytwitter-feed --data-file=-
if [[ -z "${SYNC_NOW_KEY:-}" ]]; then
  echo "SYNC_NOW_KEY missing in .env — generate one and re-run." >&2
  exit 1
fi
printf '%s' "$SYNC_NOW_KEY" | npx -y firebase-tools@latest functions:secrets:set SYNC_NOW_KEY --project mytwitter-feed --data-file=-
ADMIN_JSON="${GOOGLE_APPLICATION_CREDENTIALS:-$ROOT/serviceAccount.json}"
if [[ ! -f "$ADMIN_JSON" ]]; then
  echo "Missing Firebase admin JSON at $ADMIN_JSON" >&2
  exit 1
fi
printf '%s' "$(cat "$ADMIN_JSON")" | npx -y firebase-tools@latest functions:secrets:set ADMIN_SDK_CREDENTIALS --project mytwitter-feed --data-file=-
echo "Secrets updated. Redeploy functions:"
echo "  npx -y firebase-tools@latest deploy --only functions --project mytwitter-feed"
