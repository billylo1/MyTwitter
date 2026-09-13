# MyTwitter — Invite-only following feeds

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Self-hosted Firebase app: each invited member signs in with **X**, then sees original posts from accounts they follow (newest first, no replies; full text for reposts). Polls home timelines every 10 minutes.

**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) · **Security:** [SECURITY.md](SECURITY.md)

> Unofficial project. Not affiliated with, endorsed by, or sponsored by X Corp. or Twitter.

## Why

X is useful. But its feed algorithm is not designed to serve us. It is primarily optimized to keep our attention, prioritizing posts that trigger emotions (delight, rage, and the like). Thankfully, their APIs and terms of use allow building your own client so the feed can stay neutral — just time-ordered.

I spent some time on this repo so you can host your own client and get the benefits of X without being steered by that algorithm. Setup is not complex, and hosting does not cost much (Firebase free tier should be enough for a small group). X API usage is about `$0.005` per post retrieved. For me, that is a reasonable tradeoff for a non-biased feed and an ad-free experience. I hope this helps.

## Stack

- Firebase Hosting + Firestore + Cloud Functions (Gen 2) + Auth (custom tokens)
- X API OAuth 2.0 (`tweet.read`, `users.read`, `follows.read`, `follows.write`, `like.read`, `like.write`, `offline.access`)
- Membership via handle allowlist and/or invite links

## Prerequisites

- Node.js 22+ (matches Functions runtime)
- A Firebase project you control + Firebase CLI
- X Developer account on **pay-per-use** (or equivalent read access to home timeline)
- `gcloud` authenticated if you need to enable APIs / IAM (one-time)

## Configure your project (local-only files)

These files are **gitignored**. Copy the examples, then fill in your values:

| Copy from | To | Purpose |
|-----------|-----|---------|
| `.firebaserc.example` | `.firebaserc` | Default Firebase project id |
| `public/firebase-config.example.js` | `public/firebase-config.js` | Firebase web SDK config |
| `.env.example` | `.env` | X secrets + local script env |
| — | `functions/.env.<your-project-id>` | Functions param: `SITE_URL=https://YOUR_PROJECT_ID.web.app` |

Optional: set `FIREBASE_PROJECT_ID` to override `.firebaserc`.

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
| Website URL | `https://YOUR_PROJECT_ID.web.app` |
| Callback URI | `https://YOUR_PROJECT_ID.web.app/oauth/callback` |
| Optional local callback | `http://localhost:8765/callback` |
| Scopes | `tweet.read`, `users.read`, `follows.read`, `follows.write`, `like.read`, `like.write`, `offline.access` |

Copy **OAuth 2.0 Client ID / Client Secret**, **API Key / API Secret**, and **Bearer Token**.

Callback URI must match **exactly** (no trailing slash). A mismatch produces X’s “You weren’t able to give access to the App” error.

### 3. Firebase project

1. Create a Firebase project (or use an existing one). Set it in `.firebaserc`.
2. Enable **Authentication** (Identity Platform / Auth). Custom tokens only; no Google/Twitter provider required.
3. Authorized domains must include `YOUR_PROJECT_ID.web.app` (and `localhost` for local testing).
4. Download a service account key → save as `serviceAccount.json` in the repo root (**gitignored**).
5. Copy web app config into `public/firebase-config.js` from the Firebase console.

Initialize Auth once if needed (replace `YOUR_PROJECT_ID`):

```bash
gcloud services enable identitytoolkit.googleapis.com --project=YOUR_PROJECT_ID
# If CONFIGURATION_NOT_FOUND:
curl -X POST \
  "https://identitytoolkit.googleapis.com/v2/projects/YOUR_PROJECT_ID/identityPlatform:initializeAuth" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: YOUR_PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4. Environment

```bash
cp .env.example .env
cp .firebaserc.example .firebaserc
cp public/firebase-config.example.js public/firebase-config.js
# edit .firebaserc, firebase-config.js, and .env
echo 'SITE_URL=https://YOUR_PROJECT_ID.web.app' > functions/.env.YOUR_PROJECT_ID
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
ADMIN_HANDLE=yourhandle EXTRA_HANDLES=alice,bob npm run bootstrap
```

This writes `config/allowlist` and, if a matching `users/{id}` already exists, `members/{id}` with `role: admin`.

### 6. Secrets and deploy

```bash
./scripts/set-secrets.sh
npm run deploy
```

`set-secrets.sh` uploads X credentials, `SYNC_NOW_KEY`, and `ADMIN_SDK_CREDENTIALS` (from the service account JSON used for custom-token signing). Deploy reads the default project from `.firebaserc`. Functions pick up `SITE_URL` from `functions/.env.<projectId>`.

### 7. First sign-in

1. Open `https://YOUR_PROJECT_ID.web.app`
2. **Sign in with X** (allowlisted handles join without an invite)
3. Wait for the scheduled sync, or trigger manually (below)
4. Admins: open the **i** dialog → **Create invite link** for others

Invite URL shape: `https://YOUR_PROJECT_ID.web.app/?invite=CODE`

### 8. Manual sync (optional)

```bash
source .env
curl "https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/syncNow?key=$SYNC_NOW_KEY"
```

Without a valid `key`, `syncNow` returns 403.

## Local emulators

With `.firebaserc` and config in place:

```bash
npm run emulators
```

See `firebase.json` for emulator ports. Hosting serves `public/` (including your local `firebase-config.js`).

## Day-to-day operations

| Task | Command / action |
|------|------------------|
| Deploy all | `npm run deploy` |
| Deploy hosting only | `npx firebase-tools@latest deploy --only hosting` |
| Deploy functions only | `npx firebase-tools@latest deploy --only functions` |
| Refresh secrets | `./scripts/set-secrets.sh` then redeploy functions |
| Add handles without invite | Edit `config/allowlist.handles` in Firestore (or re-run bootstrap with `EXTRA_HANDLES`) |
| Local CLI OAuth (emergency) | `npm run oauth` — still uses localhost callback; prefer web sign-in for members |

## Project layout

```
public/                    # Hosting SPA
public/firebase-config.example.js
functions/                 # Cloud Functions (OAuth, sync, invites)
scripts/                   # bootstrap, secrets, local oauth helpers
firebase.json
.firebaserc.example
firestore.rules            # Member-gated reads
firestore.indexes.json
.env.example
docs/ARCHITECTURE.md
```

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| X: “You weren’t able to give access to the App” | Callback URI / Website URL not registered or mismatched |
| Site: “X sign-in failed” | Check `xOAuthCallback` logs; custom-token signing needs `ADMIN_SDK_CREDENTIALS`; confirm `SITE_URL` |
| Missing Firebase web config | Copy `firebase-config.example.js` → `firebase-config.js` |
| “not invited” | Handle not on allowlist and no valid invite |
| Feed empty after login | Wait for sync / run `syncNow`; confirm `users/{uid}.enabled` |
| Truncated `RT @…` text on old cards | Fixed in sync via referenced-tweet expansion; re-sync overwrites recent posts |

## Security notes

- Do not commit `.env`, `serviceAccount.json`, `.firebaserc`, or `public/firebase-config.js`.
- Firestore posts/members/usage are **member-only**.
- Firebase Auth uid equals X user id.
- Firebase web API keys are public-by-design; lock down Auth domains, API key restrictions, and Firestore rules.
- Pay-per-use billing is shared for the X project; usage appears in the info dialog.

## Before making the repo public

1. Confirm `.env`, `serviceAccount.json`, `.firebaserc`, and `public/firebase-config.js` are untracked (`git status` / `git check-ignore -v …`).
2. Rotate X OAuth secrets, bearer token, `SYNC_NOW_KEY`, and the Firebase Admin SDK key (live secrets on disk were never committed, but rotation is still wise).
3. Confirm Firestore rules and Firebase API key HTTP-referrer restrictions for your production domain.
4. On GitHub: set license to MIT, add a description, then flip the repository from private to public.

## License

[MIT](LICENSE). Each member’s following timeline is visible to other signed-in members of **your** deployment — design for an invite-only group, not a public social network.
