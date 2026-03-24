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
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_INTERACTIVE_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_BOT_USERNAME` (without `@`)
- `OWNER_TG_ID`
- `SUPER_ADMIN_ID`

Optional:
- `BOT_CLIENT_ID` (default: `demo`)
- `VIA_LOGO_FALLBACK`

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

What it does:
- creates `users` table
- extends `properties` with `price_period`, `geo`, `features`, `media`
- backfills JSONB fields from legacy columns
- creates indexes

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
3. Run SQL foundation script (if new DB)
4. Import properties
5. Redeploy backend
6. Redeploy frontend

## 7) Smoke Check (after deploy)

1. Chat responds in Mini App (no server timeout)
2. Slider/cards load and render
3. Lead submit works (header + card)
4. Telegram admin role icon and menu are correct
5. Share flows work (regular share + Telegram inline)

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

## 9) Common Issues

### `Ответ от сервера не получен`
- Usually frontend ENV is missing or points to wrong backend URL.

### Admin icon is missing
- Check `OWNER_TG_ID` / `SUPER_ADMIN_ID` in backend ENV.
- Ensure app is opened via Telegram WebApp (local browser is treated as regular user).

### CORS failure
- Ensure `FRONTEND_URL` is exact origin of frontend.

## 10) Notes

- Keep this file updated when onboarding flow changes.
- Do not put tokens, passwords, or private IDs into this document.

