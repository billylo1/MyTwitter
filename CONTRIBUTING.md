# Contributing

Thanks for contributing. This app is invite-only following feeds from X on Firebase — keep PRs focused and avoid committing secrets.

## Setup

Follow the full fork guide in [README.md](README.md):

1. Copy local config from the examples (`.firebaserc`, `public/firebase-config.js`, `.env`, `functions/.env.<projectId>`).
2. Use **Node.js 22+**.
3. Install: `npm install` and `cd functions && npm install`.

Do **not** commit:

- `.env`, `.env.*` (except `.env.example`)
- `serviceAccount.json` / Admin SDK keys
- `.firebaserc` (project-specific)
- `public/firebase-config.js` (your Firebase web config)

## Pull requests

- Keep changes small and explain **why** in the PR description.
- Match existing style in `public/`, `functions/`, and `scripts/`.
- Update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) when you change auth, data model, sync, or deploy shape.
- Do not add credentials, personal handles, or production project ids as defaults.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for private vulnerability reports.
