# MyTwitter — Family following feeds

Private Firebase-hosted feeds: each friend/family member signs in with **X**, then sees original posts from accounts they follow (newest first, no replies). Polls home timelines every 10 minutes.

## Stack

- Firebase Hosting + Firestore + Cloud Functions (Gen 2) + Auth (custom tokens)
- X API OAuth 2.0 (`tweet.read`, `users.read`, `offline.access`)
- Membership via handle allowlist and/or invite links

## One-time setup

1. **X Developer Portal** (pay-per-use app)
   - Callback URLs (exact match required):
     - `https://mytwitter-feed.web.app/oauth/callback` (web sign-in)
     - `http://localhost:8765/callback` (optional local CLI)
   - Website URL: `https://mytwitter-feed.web.app`
   - User authentication settings: **OAuth 2.0**, type **Web App**
   - Scopes: `tweet.read`, `users.read`, `offline.access`

2. **Firebase**
   - Enable **Authentication** (any provider can stay off — we use custom tokens from X OAuth)
   - Authorized domains include `mytwitter-feed.web.app`
   - Service account JSON → `serviceAccount.json` (gitignored)

3. **Local env**
   ```bash
   cp .env.example .env
   # fill X_* secrets and SYNC_NOW_KEY (random string)
   npm install
   cd functions && npm install && cd ..
   ```

4. **Bootstrap allowlist + admin member**
   ```bash
   node scripts/bootstrap-family.cjs
   # optional: EXTRA_HANDLES=alice,bob ADMIN_HANDLE=billylo node scripts/bootstrap-family.cjs
   ```

5. **Secrets + deploy**
   ```bash
   ./scripts/set-secrets.sh
   npx -y firebase-tools@latest deploy --project mytwitter-feed
   ```

6. **Sign in**
   - Open https://mytwitter-feed.web.app
   - **Sign in with X** (allowlisted handles can join without an invite)
   - Admins: info → **Create invite link** for family

7. **Manual sync** (optional)
   ```bash
   curl "https://us-central1-mytwitter-feed.cloudfunctions.net/syncNow?key=$SYNC_NOW_KEY"
   ```

## Invites

- Admin creates a link in the info dialog (or callable `createInvite`).
- Share `https://mytwitter-feed.web.app/?invite=CODE`.
- Recipient clicks Sign in with X; membership is created on successful OAuth.

## Notes

- Firestore feeds are **member-only** (not world-readable).
- Firebase Auth uid = X user id.
- Pay-per-use billing is shared across the project; usage is shown in the info dialog.
- Do not commit `.env` or `serviceAccount.json`.
- Local CLI: `npm run oauth` still works for emergencies; family should use web sign-in.
