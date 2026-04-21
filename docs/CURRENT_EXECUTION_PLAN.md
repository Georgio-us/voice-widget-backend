# Current Execution Plan (Estyle)

Last updated: 2026-04-21
Branch: `Split`
Status: paused after variables + DB migration, ready for XML phase.

## Current Environment Snapshot (non-secret)

- Backend URL: `https://voice-widget-backend-estyle.up.railway.app`
- Frontend URL: `https://voice-widget-frontend-estyle.up.railway.app`
- Frontend API URL: `https://voice-widget-backend-estyle.up.railway.app/api/audio/upload`
- Frontend assets base: `https://voice-widget-frontend-estyle.up.railway.app/assets/`
- Runtime client scope: `APP_CLIENT_ID=estyle`
- Import client scope: `IMPORT_CLIENT_ID=estyle`
- Mode: `NODE_ENV=production`

## Work Completed

1. Environment variable contract documented (`AS-IS` and `TARGET`).
2. Backend runtime switched to env-driven client scope (`APP_CLIENT_ID`).
3. Import scripts switched to `IMPORT_CLIENT_ID || APP_CLIENT_ID || demo`.
4. Frontend runtime config endpoint added (`/runtime-config.js`).
5. Split backend hardcoded fallback removed from widget runtime path.
6. DB migrated from working source DB into target estyle DB.
7. Target DB client scope normalized to `estyle`.
8. Smoke checks passed:
   - `/health` OK
   - `/api/audio/health` OK
   - `/api/cards/search` returns cards

## Current DB State (validated)

- Tables present:
  - `properties`
  - `lead_requests`
  - `support_requests`
  - `event_logs`
  - `session_logs`
- `properties` current scope:
  - `client_id=estyle`, `count=24`

## Where We Stopped

Variables and DB baseline are now operational for client environment.

Project is ready to proceed to XML integration:
1. inspect XML feed structure,
2. map XML fields to `properties` schema,
3. implement XML importer + normalizer,
4. run import and validate cards in widget.

## Next Step (First Task Tomorrow)

1. Receive XML feed URL/sample.
2. Build explicit mapping matrix:
   - `xml_field -> db_column`
   - type conversion
   - default/null rules
   - image URL handling
3. Implement `scripts/importFromXml.js` with upsert on `(client_id, external_id)`.
