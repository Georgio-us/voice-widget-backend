# ENV Target Matrix (Client Environment)

Last updated: 2026-04-21
Branch: `Split`

## Goal

Define target variable contract for a dedicated client environment on Railway:
- strict separation from demo/test environments
- no accidental cross-client data mix
- clear static vs client-specific configuration

## Current Deployment Snapshot (Estyle, non-secret)

- Backend URL: `https://voice-widget-backend-estyle.up.railway.app`
- Frontend URL (`FRONTEND_URL`): `https://voice-widget-frontend-estyle.up.railway.app`
- `APP_CLIENT_ID`: `estyle`
- `IMPORT_CLIENT_ID`: `estyle`

## Railway Services in Scope

1. `voice-widget-backend` (Node/Express)
2. `voice-widget-frontend` (static/Express host)
3. `PostgreSQL` (managed DB service)

## Variable Classes

- `STATIC`: same for all clients (platform/feature behavior)
- `CLIENT`: must be unique per client environment
- `OPTIONAL`: only if feature enabled

## Backend Variables (Target)

| Variable | Class | Required | Example | Notes |
|---|---|---|---|---|
| `OPENAI_API_KEY` | STATIC | Yes | `sk-...` | Required to start backend. |
| `DATABASE_URL` | CLIENT | Yes | `postgres://...` | Must point to client-specific DB instance. |
| `APP_CLIENT_ID` | CLIENT | Yes | `client_estyle_x` | Default client scope for repositories/runtime writes. |
| `FRONTEND_URL` | CLIENT | Yes | `https://client-widget-frontend.up.railway.app` | Used by CORS allow-list (after CORS hardening). |
| `NODE_ENV` | STATIC | Yes | `production` | Controls error payload verbosity. |
| `PORT` | STATIC | Auto | Railway injects | Keep default behavior. |
| `DISABLE_SERVER_UI` | STATIC | Optional | `0`/`1` | Usually `0` for prod widget flow. |
| `ENABLE_PERIODIC_ANALYSIS` | STATIC | Optional | `0`/`1` | Enable only if needed. |
| `VW_DEBUG_CLIENT` | STATIC | Optional | `0`/`1` | Must be `0` in prod by default. |
| `DEPLOY_TAG` | STATIC | Optional | commit/tag | Usually auto from Railway SHA fallback. |
| `TELEGRAM_BOT_TOKEN` | CLIENT | Optional | bot token | If client-level Telegram notifications needed. |
| `TELEGRAM_CHAT_ID` | CLIENT | Optional | chat id | Pair with bot token. |
| `IMPORT_CLIENT_ID` | CLIENT | Recommended | `client_estyle_x` | Used by import scripts; falls back to `APP_CLIENT_ID`. |

## Frontend Variables (Target)

Current frontend runtime uses almost no env vars; target minimal contract:

| Variable | Class | Required | Example | Notes |
|---|---|---|---|---|
| `PORT` | STATIC | Auto | Railway injects | Service port only. |
| `WIDGET_API_URL` | CLIENT | Yes | `https://client-widget-backend.up.railway.app/api/audio/upload` | Injected by frontend `/runtime-config.js` into `window.__VW_API_URL__`. |
| `WIDGET_ASSETS_BASE` | CLIENT | Optional | `https://client-widget-frontend.up.railway.app/assets/` | Injected by frontend `/runtime-config.js` into `window.__VW_ASSETS_BASE__`. |

Note:
- Widget still supports explicit `api-url` attribute and runtime overrides (query/global/storage), but production baseline should come from `WIDGET_API_URL`.

## PostgreSQL (Target)

No app-level env matrix here beyond `DATABASE_URL`, but operational target is:

1. Dedicated DB per client environment, or dedicated schema + strict client isolation.
2. No demo rows in client prod DB.
3. Unique key for listings: `(client_id, external_id)`.

## Client Isolation Rules (Must)

1. Backend in client environment must never use demo `DATABASE_URL`.
2. Imports must run with explicit `IMPORT_CLIENT_ID=<client_id>`.
3. Runtime repositories must not rely on implicit `demo` defaults for client prod.
4. Frontend published URL must point only to its paired backend.

## Required Pre-Go-Live Checks

1. `GET /health` confirms backend environment is client one.
2. `DATABASE_URL` validated against expected Railway Postgres service.
3. `/api/cards/search` returns only client listings.
4. Lead creation writes into client DB (`lead_requests` in client environment).
5. Telemetry/session logs appear in client DB only.

## Planned Follow-up

1. Add `.env.example` with this matrix.
2. Replace/contain hardcoded split/demo URL fallbacks.
3. Add startup guard for `DATABASE_URL`/`FRONTEND_URL` consistency.
