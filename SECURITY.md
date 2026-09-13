# Security Policy

## Supported versions

Security fixes are applied to the latest commit on the default branch.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems (especially anything involving credentials, tokens, or auth bypass).

Prefer one of:

1. [GitHub Security Advisories](https://github.com/billylo1/MyTwitter/security/advisories/new) (private report), or
2. Email the maintainer via the contact listed on the GitHub profile for this repository.

Include a short description, steps to reproduce, and impact. We will acknowledge reports and work on a fix as soon as practical.

## Secrets hygiene

Never commit `.env`, `serviceAccount.json`, `.firebaserc` with production ids you want private, or `public/firebase-config.js` with your live Firebase web config if you treat that as deployment-specific. See `.gitignore` and `.env.example`.
