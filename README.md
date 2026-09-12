# MyTwitter — Following feed

Public Firebase-hosted page that shows original posts from accounts you follow on X (newest first, no replies). Polls the home timeline every 10 minutes.

## Stack

- Firebase Hosting + Firestore + Cloud Functions (Gen 2)
- X API v2 `homeTimeline` with OAuth 2.0 user context
- Per-user Firestore paths so more accounts can be added later

## One-time setup

1. **X Developer Portal** (reuse your existing Basic app)
   - Add callback URL: `http://127.0.0.1:8765/callback`
   - Enable OAuth 2.0 with scopes: `tweet.read`, `users.read`, `offline.access`
   - Copy Client ID and Client Secret

2. **Firebase service account**
   - Console → Project settings → Service accounts → Generate new private key
   - Save as `serviceAccount.json` in this repo root (gitignored)

3. **Local env**
   ```bash
   cp .env.example .env
   # fill X_CLIENT_ID and X_CLIENT_SECRET
   npm install
   cd functions && npm install && cd ..
   ```

4. **Connect your X account**
   ```bash
   npm run oauth
   ```

5. **Push secrets to Cloud Functions** (same Client ID/Secret)
   ```bash
   ./scripts/set-secrets.sh
   npx -y firebase-tools@latest deploy --only functions --project mytwitter-feed
   ```

6. **First sync** (last 24 hours only)
   ```bash
   curl "https://us-central1-mytwitter-feed.cloudfunctions.net/syncNow"
   ```

Site: https://mytwitter-feed.web.app

## Notes

- Basic plan has a ~10–15k monthly post-read cap. This feed alone can fill it (~500/day). `since_id` and `exclude=replies` are required.
- Streaming / Account Activity webhooks do not deliver a following timeline on Basic.
- Do not commit `.env` or `serviceAccount.json`.
- `serviceAccount.json` is already generated for this project (gitignored).
