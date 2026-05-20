# VIA Release Checklist

## 1. Backend Env

Required:

- `TELEGRAM_INTERACTIVE_TOKEN` is set.
- `SUPER_ADMIN_ID` / `OWNER_TG_ID` are set where required.
- `SUBSCRIPTION_KEY_PEPPER` is set and non-empty.
- `TELEGRAM_INITDATA_ENFORCE_ADMIN=1`.
- `TELEGRAM_INITDATA_ALLOW_LEGACY_TGID=0`.
- `EXIT_ON_UNCAUGHT_EXCEPTION=1`.
- `EXIT_ON_UNHANDLED_REJECTION=0`.

AI catalog context, when enabled for a client:

- `AI_CATALOG_CONTEXT_ENABLED=1`.
- `AI_CATALOG_CONTEXT_CLIENT_ID=<client_id>` matches that Railway service/client database.
- `AI_CATALOG_CONTEXT_MAX_ITEMS=200` unless there is a specific reason to lower/raise it.
- `AI_CATALOG_CONTEXT_DEBUG=0` in production.
- `AI_ASSISTANT_FLAVOR=showroom` when assistant should use active catalog context naturally.

Legacy `DEMO_*` catalog variables should be removed from new deployments after `AI_*` variables are configured.

## 2. Frontend Env

- `VW_API_URL` points to the correct backend.
- `VW_CARDS_SEARCH_URL` points to the correct backend.
- `VW_SHARE_BASE_URL` points to the correct frontend.
- `TELEGRAM_BOT_USERNAME` is correct.
- If demo recording effects are used, `VW_DEMO_FX` is enabled only intentionally and disabled after recording.

## 3. DB / Migrations

Expected migrations:

- `001_stage1_foundation.sql`
- `002_olx_integrations.sql`
- `003_client_residential_complexes.sql`
- `004_specs_area_m2_decimal.sql`
- `005_subscriptions.sql`

Before launch, verify:

- `properties.client_id` is correct for the target client.
- `users.client_id` is correct.
- `lead_requests.client_id` is correct.
- `session_logs.payload.clientId` is present where needed for stats/debug continuity.
- Active seed/demo objects have canonical district/location/ЖК values.

## 4. Smoke

Backend:

- `npm --prefix Voice-Widget-Backend run smoke:soft`

Frontend:

- `npm --prefix Voice-Widget-Frontend run smoke:soft`

Both should pass or known failures must be explicitly accepted.

## 5. Runtime Checks

- Mini App opens without 403/500.
- Mini App open creates/updates Telegram user when Telegram identity is available.
- New Telegram user notification is delivered.
- Initial/default catalog shows all active objects, not only sale apartments.
- AI search returns cards for basic sale/apartment queries.
- AI/manual search with partial criteria but without explicit operation/type applies sale/apartment defaults.
- Residential complex exact/group matching works.
- Multi-ЖК queries work.
- Unknown ЖК does not create fake exact `residentialComplex`.
- Manual filters override AI fields.
- `Найдено/Доступно объектов` action works.
- Slider/list view render without duplicate or missing `cardId`.
- `Подробнее` / `Читать описание` do not overflow the modal/container.

## 6. Admin / Statistics

- Admin panel opens for owner/super-admin.
- Stats/requests section shows non-empty totals when data exists.
- Latest requests accordion opens/closes.
- Latest activity accordion opens/closes.
- Details close when the parent accordion closes.
- Unread stats/request badge appears in admin panel.
- Crown unread badge appears when there is unread admin activity.

## 7. Subscriptions

- `Управление подпиской` shows current status.
- Super-admin key generation works.
- Owner key activation works.
- After activation, DB has an up-to-date `owner_subscriptions` record.

## 8. Telegram Transport

- Webhook is installed and returns 200.
- There are no persistent `409 Conflict: getUpdates` errors.
- Lead notifications include Telegram id/username when available.
- Mini App open notifications do not spam existing users.

## 9. Debug Sanity

Debug/online diagnostics are available only to super-admin.

Debug Insights should show:

- interpreted insights
- canonical patch
- effective filters
- pre/post validation query
- strict/relaxed state
- candidate/card list
- timing/tokens when available
- last turn dialog

## 10. Operational Safety

- Production/client Postgres has Railway Daily backups enabled when the client is commercially important.
- After large imports, seed injections, migrations or onboarding, a manual `pg_dump` is saved outside Railway.
- Backend `/health` returns 200.
- A basic `/api/cards/search` request returns 200.
- Admin access route works for the expected owner/super-admin Telegram id.
- Before destructive recovery actions, use `RAILWAY_INCIDENT_RUNBOOK.md`.
