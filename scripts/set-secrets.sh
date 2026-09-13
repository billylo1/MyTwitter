#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.env"

resolve_project() {
  if [[ -n "${FIREBASE_PROJECT_ID:-}" ]]; then
    printf '%s' "$FIREBASE_PROJECT_ID"
    return
  fi
  if [[ -f "$ROOT/.firebaserc" ]]; then
    node -e "const fs=require('fs'); const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const id=r.projects&&r.projects.default; if(!id||id==='your-firebase-project-id') process.exit(2); process.stdout.write(id)" "$ROOT/.firebaserc"
    return
  fi
  echo "Set FIREBASE_PROJECT_ID or copy .firebaserc.example → .firebaserc" >&2
  exit 1
}

PROJECT="$(resolve_project)"

printf '%s' "$X_CLIENT_ID" | npx -y firebase-tools@latest functions:secrets:set X_CLIENT_ID --project "$PROJECT" --data-file=-
printf '%s' "$X_CLIENT_SECRET" | npx -y firebase-tools@latest functions:secrets:set X_CLIENT_SECRET --project "$PROJECT" --data-file=-
printf '%s' "$X_API_KEY" | npx -y firebase-tools@latest functions:secrets:set X_API_KEY --project "$PROJECT" --data-file=-
printf '%s' "$X_API_SECRET" | npx -y firebase-tools@latest functions:secrets:set X_API_SECRET --project "$PROJECT" --data-file=-
printf '%s' "$X_BEARER_TOKEN" | npx -y firebase-tools@latest functions:secrets:set X_BEARER_TOKEN --project "$PROJECT" --data-file=-
if [[ -z "${SYNC_NOW_KEY:-}" ]]; then
  echo "SYNC_NOW_KEY missing in .env — generate one and re-run." >&2
  exit 1
fi
printf '%s' "$SYNC_NOW_KEY" | npx -y firebase-tools@latest functions:secrets:set SYNC_NOW_KEY --project "$PROJECT" --data-file=-
ADMIN_JSON="${GOOGLE_APPLICATION_CREDENTIALS:-$ROOT/serviceAccount.json}"
if [[ ! -f "$ADMIN_JSON" ]]; then
  echo "Missing Firebase admin JSON at $ADMIN_JSON" >&2
  exit 1
fi
printf '%s' "$(cat "$ADMIN_JSON")" | npx -y firebase-tools@latest functions:secrets:set ADMIN_SDK_CREDENTIALS --project "$PROJECT" --data-file=-
echo "Secrets updated for project $PROJECT. Redeploy functions:"
echo "  npx -y firebase-tools@latest deploy --only functions"
