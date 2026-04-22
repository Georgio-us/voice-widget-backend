# Current Execution Plan (Estyle)

Last updated: 2026-04-22
Branch: `Split`
Status: baseline ready; moving from import completion to field-contract normalization.

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
   - total imported: `547`
   - operation split: `539 sale`, `8 rent` (from `price_freq=week`)
6. Legacy non-feed rows cleaned from target scope.
7. Post-clean validation:
   - `properties` for `estyle`: `547` rows
   - sale/rent split preserved (`539/8`)

## Current DB State (validated)

- Tables present:
  - `properties`
  - `lead_requests`
  - `support_requests`
  - `event_logs`
  - `session_logs`
- Production scope currently driven by XML baseline only.

## Current Investigation Focus

Goal of current iteration: define exact contract `XML -> properties -> slider`.

Artifacts:
1. mapping baseline: `docs/XML_FEED_MAPPING.md`
2. field-contract audit: `docs/XML_CONTRACT_AUDIT.md`

Key discovered issues:
1. description is displayed with raw HTML tags in slider.
2. multi-image data exists in feed/DB, but card payload currently returns only first image.
3. `floor` is sparse and partially missed because feed uses localized nested node.
4. `price_per_m2` is not mapped/populated yet.
5. location labels need de-dup normalization policy.

## Where We Stop In This Session

Research phase complete for field contract baseline.

Next coding slice (planned):
1. backend payload: include full `images[]`.
2. description strategy: sanitize HTML vs strip-to-text.
3. importer update: parse nested localized `floor`.
4. `price_per_m2` policy: compute or hide if absent.
5. location de-dup normalization for card subtitle.
