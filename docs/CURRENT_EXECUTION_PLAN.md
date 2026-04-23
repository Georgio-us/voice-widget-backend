# Current Execution Plan (Estyle)

Last updated: 2026-04-23
Branch: `Split`
Status: XML baseline is live; current priority is CRM-ready lead payload contract.

## Current Environment Snapshot (non-secret)

- Backend URL: `https://voice-widget-backend-estyle.up.railway.app`
- Frontend URL: `https://voice-widget-frontend-estyle.up.railway.app`
- Frontend API URL: `https://voice-widget-backend-estyle.up.railway.app/api/audio/upload`
- Frontend assets base: `https://voice-widget-frontend-estyle.up.railway.app/assets/`
- Runtime client scope: `APP_CLIENT_ID=estyle`
- Import client scope: `IMPORT_CLIENT_ID=estyle`
- Mode: `NODE_ENV=production`

## Work Completed

1. Environment contracts documented (`AS-IS`, `TARGET`, onboarding, SQL runbook).
2. Hardcoded runtime client and API fallbacks removed from critical paths.
3. DB migrated into estyle environment and normalized to `client_id=estyle`.
4. XML importer implemented (`scripts/importFromXml.js`).
5. Full XML import executed successfully:
   - total imported: `548`
   - operation split: `540 sale`, `8 rent` (from `price_freq=week`)
6. Legacy non-feed rows cleaned from target scope.
7. Post-clean validation:
   - `properties` for `estyle`: `548` rows
   - sale/rent split preserved (`540/8`)
8. Front card contract normalized for current feed:
   - full image gallery payload (`images[]`)
   - icon fields (`area/plot/beds/baths/pool/parking`)
   - location row simplified to `city / province`
   - status row normalized to `property_type + listing_status` (`NEW BUILD` / `RESALE` / `RENT`)

## Current DB State (validated)

- Tables present:
  - `properties`
  - `lead_requests`
  - `support_requests`
  - `event_logs`
  - `session_logs`
- Production scope currently driven by XML baseline only.

## Current Investigation Focus

Goal of current iteration: define and implement CRM-ready lead contract for Mediaelx.

Primary artifact:
1. `docs/LEAD_CRM_CONTRACT.md`

Scope now:
1. unify lead JSON shape for all widget lead entry points.
2. add `ai_notes`/`summary` based on dialog insights.
3. guarantee `propertyId` propagation for object-context leads.
4. prepare stable outbound-ready payload (without enabling outbound call yet).

## Where We Stop In This Session

Planning phase complete for CRM lead payload.

Next coding slice (planned):
1. extend `POST /api/leads` input contract with optional `summary` / `aiNotes` / `insights`.
2. implement server-side `ai_notes` builder from `session_logs` fallback + request payload.
3. persist enriched payload in `lead_requests.extra` (or dedicated columns in follow-up migration).
4. wire frontend lead forms to pass `propertyId` from active/selected card context.
5. add one stable outbound payload builder (pure function) and log-ready preview for CRM handoff.
6. update onboarding docs with final lead schema and webhook integration steps.
