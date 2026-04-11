# Client Onboarding Runbook (Railway + Postgres)

This file is a quick internal playbook for launching a new client on the same codebase.
No secrets are stored here.

## 1) Goal

Spin up a new client environment by changing only:
- Railway environment variables
- Data in Postgres

No code fork is required for each client.

## 2) Required Services

- `voice-widget-backend` (Node backend)
- `Voice-Widget-Frontend` (frontend host)
- `Postgres` (Railway database)

## 3) Environment Variables

### Backend (`voice-widget-backend`)

Required:
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `FRONTEND_URL` (frontend origin, e.g. `https://<frontend>.up.railway.app`)
- `OLX_AUTH_URL`
- `OLX_TOKEN_URL`
- `OLX_CLIENT_ID`
- `OLX_CLIENT_SECRET`
- `OLX_REDIRECT_URI` (e.g. `https://<backend>.up.railway.app/api/olx/callback`)
- `OLX_STATE_SECRET` (random long secret used to sign OAuth state)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_INTERACTIVE_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_BOT_USERNAME` (without `@`)
- `OWNER_TG_ID`
- `SUPER_ADMIN_ID`
- `SUBSCRIPTION_KEY_PEPPER` (secret salt for activation key hash verification)

Optional:
- `BOT_CLIENT_ID` (default: `demo`)
- `VIA_LOGO_FALLBACK`
- `OLX_SCOPES` (space-separated OAuth scopes required by OLX API)
- `TELEGRAM_WEBAPP_BOT_TOKEN` (explicit override for WebApp `initData` verification token)
- `TELEGRAM_INITDATA_ENFORCE_ADMIN` (strict Telegram signature check for admin access, recommended `1`)
- `TELEGRAM_INITDATA_ALLOW_LEGACY_TGID` (legacy fallback via plain `tgUserId`, recommended `0`)
- `EXIT_ON_UNCAUGHT_EXCEPTION` (default `1`; set `0` only for emergency diagnostics)
- `EXIT_ON_UNHANDLED_REJECTION` (default `0`; set `1` for strict fail-fast mode)

### Frontend (`Voice-Widget-Frontend`)

Required:
- `FRONTEND_APP_URL=https://<frontend>.up.railway.app`
- `CARDS_API_BASE=https://<backend>.up.railway.app/api/cards`
- `VW_API_URL=https://<backend>.up.railway.app/api/audio/upload`
- `VW_CARDS_SEARCH_URL=https://<backend>.up.railway.app/api/cards/search?limit=2000`
- `VW_SHARE_BASE_URL=https://<frontend>.up.railway.app`
- `TELEGRAM_BOT_USERNAME` (without `@`)

## 4) Database Setup (manual SQL)

Run the foundation SQL once on the target DB:

- `sql/001_stage1_foundation.sql`
- `sql/002_olx_integrations.sql`
- `sql/003_client_residential_complexes.sql`
- `sql/004_specs_area_m2_decimal.sql`
- `sql/005_subscriptions.sql`

What it does:
- creates `users` table
- extends `properties` with `price_period`, `geo`, `features`, `media`
- backfills JSONB fields from legacy columns
- creates indexes
- creates subscription schema (`owner_subscriptions`, `license_keys`, `license_redemptions`)

## 4.1) Telegram/Auth Variables Explained (important)

### Which Telegram token is used where

- `TELEGRAM_INTERACTIVE_TOKEN`
  - Interactive bot token (Mini App bot).
  - Used for Telegram WebApp identity (`initData`) verification.
  - This is the main token for role detection in Mini App.

- `TELEGRAM_BOT_TOKEN`
  - Notification bot token (alerts/messages).
  - Not used as primary WebApp identity token anymore.

- `TELEGRAM_WEBAPP_BOT_TOKEN` (optional)
  - Explicitly forces which token must be used for WebApp `initData` verification.
  - If set, it has highest priority.

Verification token priority in backend:
1. `TELEGRAM_WEBAPP_BOT_TOKEN`
2. `TELEGRAM_INTERACTIVE_TOKEN`
3. `TELEGRAM_BOT_TOKEN`

### Access mode flags

- `TELEGRAM_INITDATA_ENFORCE_ADMIN=1`
  - Strict protection enabled.
  - Admin/owner/super-admin access is granted only if Telegram signature is valid.

- `TELEGRAM_INITDATA_ALLOW_LEGACY_TGID=0`
  - Plain `tgUserId` fallback disabled.
  - Recommended for production.

### Safe rollback (no code revert)

If strict mode causes emergency access issues, temporarily switch to:
- `TELEGRAM_INITDATA_ENFORCE_ADMIN=0`
- `TELEGRAM_INITDATA_ALLOW_LEGACY_TGID=1`

Then redeploy backend. This restores legacy behavior.

## 4.2) Crash Policy Flags (important)

- `EXIT_ON_UNCAUGHT_EXCEPTION`
  - `1` (default): backend exits on `uncaughtException` (fail-fast).
  - `0`: backend logs error and keeps process alive (diagnostics mode; use carefully).

- `EXIT_ON_UNHANDLED_REJECTION`
  - `0` (default): backend logs `unhandledRejection` and keeps process alive.
  - `1`: backend exits on `unhandledRejection` (strict mode).

## 5) Import Properties

Use one of scripts:
- `scripts/importFromCsv.js`
- `scripts/importFromXlsx.js`
- `scripts/importFromJs.js`

Before import:
- set `IMPORT_CLIENT_ID=<client_key>` (or rely on default `demo`)

Examples:
- `IMPORT_CLIENT_ID=demo node scripts/importFromCsv.js ./data/import/properties.csv`
- `IMPORT_CLIENT_ID=demo node scripts/importFromXlsx.js ./data/import/properties.xlsx`

## 6) Deploy Order

1. Update backend ENV
2. Update frontend ENV
3. Run SQL scripts in order (if new DB): `001 -> 002 -> 003 -> 004 -> 005`
4. Import properties
5. Redeploy backend
6. Redeploy frontend

## 7) Smoke Check (after deploy)

1. Chat responds in Mini App (no server timeout)
2. Slider/cards load and render
3. Lead submit works (header + card)
4. Telegram admin role icon and menu are correct
5. Share flows work (regular share + Telegram inline)
6. With strict mode enabled:
   - owner/super-admin still see admin panel
   - guest user cannot access admin APIs

## 7.1) Local Smoke Commands (non-blocking option)

Backend:

```bash
cd Voice-Widget-Backend
npm run smoke
```

Frontend:

```bash
cd Voice-Widget-Frontend
npm run smoke
```

Soft mode (does not fail process, prints warnings/errors only):

```bash
cd Voice-Widget-Backend && npm run smoke:soft
cd Voice-Widget-Frontend && npm run smoke:soft
```

## 8) SQL Verification Snippets

Check new columns:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'properties'
  AND column_name IN ('price_period', 'geo', 'features', 'media')
ORDER BY column_name;
```

Check backfill:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE geo IS NOT NULL) AS geo_filled,
  COUNT(*) FILTER (WHERE features IS NOT NULL) AS features_filled,
  COUNT(*) FILTER (WHERE media IS NOT NULL) AS media_filled
FROM properties;
```

Check indexes:

```sql
SELECT indexname
FROM pg_indexes
WHERE tablename IN ('users', 'properties')
ORDER BY indexname;
```

Check subscription tables:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('owner_subscriptions', 'license_keys', 'license_redemptions')
ORDER BY table_name;
```

Check subscription enums:

```sql
SELECT typname
FROM pg_type
WHERE typname IN ('subscription_plan', 'subscription_status', 'activation_source')
ORDER BY typname;
```

Optional: clear generated keys for a freshly cloned client DB (keep table structure):

```sql
BEGIN;
TRUNCATE TABLE license_redemptions RESTART IDENTITY;
TRUNCATE TABLE license_keys RESTART IDENTITY;
TRUNCATE TABLE owner_subscriptions RESTART IDENTITY;
COMMIT;
```

## 9) Common Issues

### `Ответ от сервера не получен`
- Usually frontend ENV is missing or points to wrong backend URL.

### Admin icon is missing
- Check `OWNER_TG_ID` / `SUPER_ADMIN_ID` in backend ENV.
- Ensure app is opened via Telegram WebApp (local browser is treated as regular user).
- If strict mode is enabled, verify `TELEGRAM_INTERACTIVE_TOKEN` is correct for this Mini App bot.
- Check auth flags:
  - prod target: `TELEGRAM_INITDATA_ENFORCE_ADMIN=1`, `TELEGRAM_INITDATA_ALLOW_LEGACY_TGID=0`

### CORS failure
- Ensure `FRONTEND_URL` is exact origin of frontend.

## 10) Notes

- Keep this file updated when onboarding flow changes.
- Do not put tokens, passwords, or private IDs into this document.
