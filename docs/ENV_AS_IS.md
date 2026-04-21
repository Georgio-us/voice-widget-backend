# ENV AS-IS Snapshot (Backend)

Last updated: 2026-04-21
Branch: `Split`

## Scope

This document captures the current backend configuration state "as is":
- environment variables used in code
- hardcoded fallbacks/URLs
- client isolation defaults (not yet client-specific)
- risks for Railway multi-environment setup

## .env Status

- `.env` is ignored in git via `.gitignore`.
- No `.env*` files are present in this repository at snapshot time.
- Runtime config is expected from Railway environment variables.

## Environment Variables Used

| Variable | Where used | Current behavior / fallback | Required in prod |
|---|---|---|---|
| `OPENAI_API_KEY` | `index.js`, `controllers/audioController.js` | Backend exits on startup if missing (`index.js`) | Yes |
| `DATABASE_URL` | `services/db.js` | Logs warning if missing; DB pool still initialized with undefined connection string | Yes |
| `PORT` | `index.js` | Fallback `3001` | Yes (Railway usually injects) |
| `FRONTEND_URL` | `index.js` (CORS list) | Optional; merged into allowed origins list | Yes (for clean CORS policy) |
| `NODE_ENV` | `index.js` | Fallback `development` for behavior/logging | Yes |
| `DISABLE_SERVER_UI` | `controllers/audioController.js` | Fallback disabled (`''` -> false) | Optional |
| `ENABLE_PERIODIC_ANALYSIS` | `controllers/audioController.js` | Fallback disabled (`''` -> false) | Optional |
| `DEPLOY_TAG` | `controllers/audioController.js` | Falls back to `RAILWAY_GIT_COMMIT_SHA` then `unknown` | Optional |
| `RAILWAY_GIT_COMMIT_SHA` | `controllers/audioController.js` | Used as fallback build tag source | Optional |
| `VW_DEBUG_CLIENT` | `controllers/audioController.js` | Disabled unless explicitly `1` | Optional |
| `TELEGRAM_BOT_TOKEN` | `services/telegramNotifier.js` | Optional, notifier best-effort | Optional |
| `TELEGRAM_CHAT_ID` | `services/telegramNotifier.js` | Optional, notifier best-effort | Optional |
| `IMPORT_CLIENT_ID` | `scripts/importFromCsv.js`, `scripts/importFromXlsx.js` | Fallback `demo` | Optional for scripts, recommended in client setup |

## Hardcoded Values / Fallback Hotspots

### CORS origins
- `index.js` includes hardcoded GitHub Pages origins:
  - `https://georgio-us.github.io/Voice-Widget-Frontend/`
  - `https://georgio-us.github.io`
- Current code path still ends with `callback(null, true)`, effectively allowing all origins.

### Client identity defaults
- `DEFAULT_CLIENT_ID = 'demo'` in:
  - `services/propertiesRepository.js`
  - `services/leadsRepository.js`
  - `services/supportRepository.js`
- Import scripts fallback to `demo`:
  - `scripts/importFromCsv.js`
  - `scripts/importFromXlsx.js`
- `scripts/importFromJs.js` hardcodes `const CLIENT_ID = 'demo'`.

### Misc endpoints/placeholders
- `data/properties.js` uses placeholder image base `https://<backend-host>/...`.
- Runtime URLs in logs are local-formatted (`http://0.0.0.0:${PORT}`), informational only.

## AS-IS Risk Notes (for Railway duplicate environments)

1. `DATABASE_URL` mismatch risk:
   - If backend service points to old environment DB, client environment will show wrong/test properties.

2. `demo` default leakage risk:
   - Any service/script call without explicit client ID can read/write `demo`.

3. CORS openness risk:
   - Current CORS config effectively allows all origins despite origin list.

4. Fallback coupling risk:
   - Hardcoded demo-oriented values can hide misconfiguration during rollout.

## Immediate Next Doc (planned)

- `ENV_TARGET_MATRIX.md`:
  - static vs client-specific variables
  - required values per Railway service (backend/frontend/postgres context)
  - "must-set" checklist before go-live
