# Contributing

## Prerequisites

- Node.js 20+
- A [GitHub App](https://github.com/settings/apps/new) with **Device flow** enabled and **Contents** read & write permission
- A [Cloudflare](https://dash.cloudflare.com/sign-up) account (free tier, for the OAuth CORS proxy)

## VS Code extension

```bash
npm install && npm run build
# Press F5 in VS Code → "Graft: Open Document" → paste a GitHub URL
```

Watch mode:

```bash
npm run watch
```

## Web app

```bash
cp .env.example .env
```

Set both values in `.env`:
- `VITE_GITHUB_CLIENT_ID` — your GitHub App's client ID
- `VITE_AUTH_PROXY_URL` — your deployed CORS proxy URL (see below)

Then:

```bash
npm run dev:web        # Dev server at localhost:5173
npm run build:web      # Production build → dist-web/
npm run preview:web    # Preview production build
```

## CORS proxy (Cloudflare Worker)

GitHub's OAuth endpoints (`github.com/login/*`) don't support CORS, so browser-based OAuth goes through a tiny proxy on Cloudflare Workers.

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_ID   # paste your GitHub App client ID
npx wrangler deploy
```

This gives you a URL like `https://graft-auth-proxy.<you>.workers.dev` — use it as `VITE_AUTH_PROXY_URL`.

The worker only proxies two paths (`/login/device/code` and `/login/oauth/access_token`), validates the client ID, and locks CORS to a single allowed origin.

## Tests

```bash
npm test               # Run once
npm run test:watch     # Watch mode
npm run typecheck      # Type check only
```

A pre-commit hook runs `typecheck` + `test` automatically via Husky.

## Deployment

Push to `main` triggers two GitHub Actions workflows:
- **CI** — typecheck, test, build
- **Deploy Web** — build + deploy to GitHub Pages

Required repository variables (Settings → Variables → Actions):
- `GRAFT_CLIENT_ID` — GitHub App client ID
- `GRAFT_AUTH_PROXY_URL` — deployed worker URL
