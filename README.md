# MyTwitter — Family following feeds

Private Firebase-hosted feeds: each friend/family member signs in with **X**, then sees original posts from accounts they follow (newest first, no replies; full text for reposts). Polls home timelines every 10 minutes.

**Site:** https://mytwitter-feed.web.app  
**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Stack

- Firebase Hosting + Firestore + Cloud Functions (Gen 2) + Auth (custom tokens)
- X API OAuth 2.0 (`tweet.read`, `users.read`, `follows.read`, `follows.write`, `like.read`, `like.write`, `offline.access`)
- Membership via handle allowlist and/or invite links

## Prerequisites

- Node.js 22+ (matches Functions runtime)
- Firebase CLI access to project `mytwitter-feed` (or your fork’s project id)
- X Developer account on **pay-per-use** (or equivalent read access to home timeline)
- `gcloud` authenticated if you need to enable APIs / IAM (one-time)

## Installation

### 1. Clone and install

```bash
git clone https://github.com/billylo1/MyTwitter.git
cd MyTwitter
npm install
cd functions && npm install && cd ..
```

### 2. X Developer Portal

Create or open a **pay-per-use** app with **User authentication**:

| Setting | Value |
|---------|--------|
| App type | Web App |
| Website URL | `https://mytwitter-feed.web.app` |
| Callback URI | `https://mytwitter-feed.web.app/oauth/callback` |
| Optional local callback | `http://localhost:8765/callback` |
| Scopes | `tweet.read`, `users.read`, `follows.read`, `follows.write`, `like.read`, `like.write`, `offline.access` |

Copy **OAuth 2.0 Client ID / Client Secret**, **API Key / API Secret**, and **Bearer Token**.

Callback URI must match **exactly** (no trailing slash). A mismatch produces X’s “You weren’t able to give access to the App” error.

### 3. Firebase project

1. Use project `mytwitter-feed` (or change `.firebaserc` / deploy `--project`).
2. Enable **Authentication** (Identity Platform / Auth). Custom tokens only; no Google/Twitter provider required.
3. Authorized domains must include `mytwitter-feed.web.app` (and `localhost` for local testing).
4. Download a service account key → save as `serviceAccount.json` in the repo root (**gitignored**).

Initialize Auth once if needed:

```bash
gcloud services enable identitytoolkit.googleapis.com --project=mytwitter-feed
# If CONFIGURATION_NOT_FOUND:
curl -X POST \
  "https://identitytoolkit.googleapis.com/v2/projects/mytwitter-feed/identityPlatform:initializeAuth" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: mytwitter-feed" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4. Environment

```bash
cp .env.example .env
```

Fill at least:

```bash
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_API_KEY=...
X_API_SECRET=...
X_BEARER_TOKEN=...
SYNC_NOW_KEY=$(openssl rand -hex 24)   # required for syncNow
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
```

### 5. Bootstrap allowlist and admin

```bash
npm run bootstrap
# or:
ADMIN_HANDLE=billylo EXTRA_HANDLES=alice,bob npm run bootstrap
```

This writes `config/allowlist` and, if a matching `users/{id}` already exists, `members/{id}` with `role: admin`.

### 6. Secrets and deploy

```bash
./scripts/set-secrets.sh
npm run deploy
# equivalent: npx -y firebase-tools@latest deploy --project mytwitter-feed
```

`set-secrets.sh` uploads X credentials, `SYNC_NOW_KEY`, and `ADMIN_SDK_CREDENTIALS` (from the service account JSON used for custom-token signing).

### 7. First sign-in

1. Open https://mytwitter-feed.web.app  
2. **Sign in with X** (allowlisted handles join without an invite)  
3. Wait for the scheduled sync, or trigger manually (below)  
4. Admins: open the **i** dialog → **Create invite link** for family  

Invite URL shape: `https://mytwitter-feed.web.app/?invite=CODE`

### 8. Manual sync (optional)

```bash
source .env
curl "https://us-central1-mytwitter-feed.cloudfunctions.net/syncNow?key=$SYNC_NOW_KEY"
```

Without a valid `key`, `syncNow` returns 403.

## Day-to-day operations

| Task | Command / action |
|------|------------------|
| Deploy all | `npm run deploy` |
| Deploy hosting only | `npx firebase-tools@latest deploy --only hosting --project mytwitter-feed` |
| Deploy functions only | `npx firebase-tools@latest deploy --only functions --project mytwitter-feed` |
| Refresh secrets | `./scripts/set-secrets.sh` then redeploy functions |
| Add handles without invite | Edit `config/allowlist.handles` in Firestore (or re-run bootstrap with `EXTRA_HANDLES`) |
| Local CLI OAuth (emergency) | `npm run oauth` — still uses localhost callback; prefer web sign-in for family |

## Project layout

```
public/           # Hosting SPA (app.js, styles, index.html)
functions/        # Cloud Functions (OAuth, sync, invites)
scripts/          # bootstrap, secrets, local oauth helpers
firestore.rules   # Member-gated reads
docs/ARCHITECTURE.md
```

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| X: “You weren’t able to give access to the App” | Callback URI / Website URL not registered or mismatched |
| Site: “X sign-in failed” | Check `xOAuthCallback` logs; custom-token signing needs `ADMIN_SDK_CREDENTIALS` |
| “not invited” | Handle not on allowlist and no valid invite |
| Feed empty after login | Wait for sync / run `syncNow`; confirm `users/{uid}.enabled` |
| Truncated `RT @…` text on old cards | Fixed in sync via referenced-tweet expansion; re-sync overwrites recent posts |

## Security notes

- Do not commit `.env` or `serviceAccount.json`.
- Firestore posts/members/usage are **member-only**.
- Firebase Auth uid equals X user id.
- Pay-per-use billing is shared for the X project; usage appears in the info dialog.

## License / privacy

Personal / family use. Each member’s following timeline is visible to other signed-in members of this app.
