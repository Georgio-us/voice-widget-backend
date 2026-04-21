# Client Onboarding (Railway + Postgres)

Last updated: 2026-04-21
Branch: `Split`
Audience: internal ops/dev team

## Current Execution Status (Estyle, 2026-04-21)

- Phase 1 completed: client environment and URLs configured.
- Phase 2 completed: required backend/frontend variables configured in Railway.
- Phase 3 completed: DB migrated and normalized to `client_id=estyle`.
- Current pause point: before XML feed mapping/import implementation.
- See execution snapshot: `docs/CURRENT_EXECUTION_PLAN.md`.

## Objective

Create an isolated production environment for a new client, with:
- dedicated backend/frontend deploy context
- dedicated database context
- explicit client-specific variables
- reproducible import/update process for listings feed

## Phase 1: Environment Clone and Isolation

1. Create new Railway environment for client (do not reuse demo env).
2. Attach backend and frontend services to this environment.
3. Attach client-dedicated Postgres service (or confirmed dedicated DB context).
4. Verify service URLs are client-specific.

Exit criteria:
- client backend URL and frontend URL are distinct from demo URLs.
- client DB is empty or controlled baseline only.

## Phase 2: Variables Setup

Use `ENV_TARGET_MATRIX.md` as the source of truth.

### Backend (must set)

1. `OPENAI_API_KEY`
2. `DATABASE_URL` (client DB)
3. `APP_CLIENT_ID` (client runtime scope, e.g. `client_estyle_x`)
4. `FRONTEND_URL` (client frontend URL)
5. `NODE_ENV=production`

### Backend (as needed)

1. `IMPORT_CLIENT_ID=<client_id>` (if omitted, importer uses `APP_CLIENT_ID`)
2. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (if enabled)
3. `DISABLE_SERVER_UI`, `ENABLE_PERIODIC_ANALYSIS`, `VW_DEBUG_CLIENT` (feature flags)

### Frontend

1. `PORT` (Railway-managed)
2. Target API endpoint policy (currently via widget API URL resolution chain)

Exit criteria:
- all required vars present in Railway UI for client env.
- `DATABASE_URL` and `FRONTEND_URL` verified manually.

## Phase 3: Data Baseline and SQL Guardrails

Before feed import, run verification SQL in client DB.

### Minimal sanity checks

```sql
-- check properties volume by client
SELECT client_id, COUNT(*) AS cnt
FROM properties
GROUP BY client_id
ORDER BY cnt DESC;

-- check lead requests by client
SELECT client_id, COUNT(*) AS cnt
FROM lead_requests
GROUP BY client_id
ORDER BY cnt DESC;
```

### Ensure unique listing identity

```sql
CREATE UNIQUE INDEX IF NOT EXISTS properties_client_external_uidx
ON properties (client_id, external_id);
```

### Optional cleanup for wrong client seed

```sql
-- use carefully in client env only
DELETE FROM properties WHERE client_id = 'demo';
```

Exit criteria:
- no unexpected demo rows in client environment.
- `(client_id, external_id)` uniqueness guaranteed.

## Phase 4: Feed Import Flow

Current status:
- CSV/XLSX import scripts exist.
- XML import will be integrated in the same normalized upsert pattern.

Import principles:

1. Always import with explicit client ID (`IMPORT_CLIENT_ID`).
2. Use upsert on `(client_id, external_id)`.
3. Keep inactive/removed feed entries controlled (soft deactivate preferred).

Exit criteria:
- expected listing count imported for client.
- sample cards validate in `/api/cards/search` and widget UI.

## Phase 5: End-to-End Validation

1. Backend health:
   - `GET /health`
2. Cards:
   - `GET /api/cards/search?...`
3. Dialog:
   - `POST /api/audio/upload` text flow
4. Leads:
   - `POST /api/leads` and verify DB row
5. Support:
   - `POST /api/support` and verify DB row
6. Telemetry/session:
   - verify writes to `event_logs` and `session_logs`

Exit criteria:
- full path works in client environment only.

## Static vs Client-Specific Quick Reference

Client-specific (must vary per client):
- `DATABASE_URL`
- `FRONTEND_URL`
- `IMPORT_CLIENT_ID`
- frontend->backend API URL binding
- optional Telegram credentials

Mostly static:
- `NODE_ENV`
- feature flags defaults
- platform port behavior

## Operational Notes

1. Do not rely on default `demo` in production client environment.
2. Avoid hidden runtime fallbacks when publishing client widget.
3. Keep this onboarding updated after each infrastructure change.
