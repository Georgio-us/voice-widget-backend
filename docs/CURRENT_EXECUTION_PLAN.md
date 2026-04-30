# Current Execution Plan (Estyle)

Last updated: 2026-04-30
Branch: `Split`
Status: XML baseline is live; priority is deterministic AI extraction -> canonical query -> stable candidate pool.

Primary contract reference: `docs/EXECUTION_PATH_CONTRACT.md` (locked runtime path).

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

Goal of current iteration: stabilize selection quality for real XML inventory under LLM extraction.

Primary runtime path:
1. `input -> extraction(mode) -> insights -> canonicalQueryV1 -> candidate pool`.

Scope now:
1. `EXTRACTION_MODE` switch (`rules | llm | hybrid`) in backend runtime.
2. strict no-overwrite insights policy (fill empty only).
3. canonical budget guard by operation:
   - sale accepts only `>= 10000`;
   - rent accepts `< 10000` (current product rule).
4. location/type normalization fixes for RU/ES/EN variants.
5. relaxed fallback chain (drop non-core constraints progressively when strict gives 0).
6. softening of core numeric constraints for recall:
   - `minPrice = minPrice * 0.8`
   - `minArea = minArea * 0.8`
   - `plotArea = plotArea * 0.8`

## Work Completed In This Track (2026-04-26 .. 2026-04-28)

1. LLM schema-first extraction pipeline added with runtime mode switch.
2. Debug now returns extraction mode + applied fields.
3. Budget shorthand parsing fixed (`100к`, `100k`), room shorthand fixed (`2к`).
4. Type fallback and near-sea routing fixed:
   - `квартира` -> `type=apartment`;
   - `возле моря` -> `features.near_sea` (not location).
5. RU location aliases normalized for canonical matching (`Торревьеха` -> `torrevieja`, etc.).
6. Sale low-budget leak fixed in canonical (`2500` for sale is dropped from query).
7. Relaxed chain implemented and exposed in `queryTraceV1.relaxed`.
8. Live smoke tests confirm stable flow and reproducible candidate traces.
9. Legacy orchestration isolation milestone:
   - `stage/role/meta` removed from runtime execution contract;
   - `stage/role` removed from runtime frontend payload/debug contract;
   - interaction role transitions disabled in active runtime path.
10. Assistant prompt path trimmed:
   - removed `RMV3_SERVER_FACTS_V1` + `RMV3_GUARDRAILS_V1` from active main-call prompt;
   - removed `allowedFactsSnapshot` and `post-handoff` system injections from active main-call prompt;
   - main assistant temperature reduced from `0.5` to `0.4`.

## Where We Stop In This Session

Baseline is working and testable on live deploy.

Latest coding slice applied (2026-04-30):
1. coastal phrase routing hardened in canonical:
   - `возле пляжа` / `рядом с пляжем` / `near beach` now map to `features.near_sea`;
   - coastal intent no longer falls back into `location` token.
2. rooms canonical now supports multi-value:
   - `rooms` can be scalar (`2`) or array (`[1,2]`);
   - candidate filter supports `IN` match for array mode.

Next coding slice (planned):
1. city/province explicit semantics in debug + controlled fallback policy;
2. multi-city support (`cities[]`) with city-first filtering;
3. fine-tune relaxed order/weights from real zero-result transcripts;
4. continue CRM outbound contract work (`docs/LEAD_CRM_CONTRACT.md`) after selection stabilization.
