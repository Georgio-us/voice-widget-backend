# Insights Target Contract (TO-BE)

Last updated: 2026-04-30  
Branch: `Split`  
Status: design baseline for phased implementation.

Companion docs:
- `docs/INSIGHTS_AS_IS.md` (current behavior)
- `docs/XML_FEED_MAPPING.md` (feed mapping baseline)

## Purpose

Define a realistic, implementation-ready target pipeline for AI-only selection:

1. normalize incoming property and extraction fields;
2. collect a fixed insight schema;
3. build one canonical query for search;
4. produce candidates from that query;
5. keep the pipeline observable in debug.

This is the target contract for implementation in small iterations.

## Single Execution Chain (Target)

`source insights -> canonical patch -> pre-validation query -> post-validation query -> candidate pool -> match/explain`

Rules:
1. Search MUST use only post-validation query.
2. `stage/meta/role` MUST NOT participate in query building.
3. Any dropped field MUST be logged with reason.

## 1) Normalizer (Field Canonicalization)

All fields used in search must be canonicalized before query build.

### Canonical types (agreed set)

- `operation`: enum `sale | rent`
- `type`: slug enum (`apartment`, `villa`, `townhouse`, `penthouse`, `commercial`, ...)
- `location`: legacy single location token (kept for compatibility)
- `cities[]`: normalized city list (city-first matching)
- `province`: normalized province fallback
- `rooms`: integer or integer array
- `bathrooms`: integer
- `minPrice`: integer (EUR)
- `minArea`: integer (`m2`)
- `plotArea`: integer (`m2`)
- `floor`: integer
- `hasParking`: boolean
- `hasPool`: boolean
- `hasTerrace`: boolean
- `orientation`: enum/text normalized (`north`, `south`, `east`, `west`, ...)
- `distanceBeachKmMax`: number
- `distanceAirportKmMax`: number
- `features[]`: normalized tag slugs

### Normalization principles

1. Numbers: strip symbols and parse to numeric type.
2. Booleans: map `yes/true/1` -> `true`, `no/false/0` -> `false`.
3. Enums/slugs: map multilingual labels to one internal value.
4. Text locations: keep source text but also compute normalized compare form.
5. Coastal phrases (`near sea`, `возле моря`, `cerca del mar`) are NOT location; they must map to `features[]` (slug `near_sea`).

## 2) Insights We MUST Collect

Target insight schema (AI-only, 16 fields in selection path):

1. `operation`
2. `type`
3. `location` (legacy compatibility field)
4. `cities[]` (primary city scope)
5. `province` (fallback scope)
6. `rooms`
7. `bathrooms`
8. `minPrice` (from budget)
9. `minArea` (built area)
10. `plotArea`
11. `floor`
12. `hasParking`
13. `hasPool`
14. `hasTerrace`
15. `orientation`
16. `distanceBeachKmMax`
17. `distanceAirportKmMax`
18. `features[]`

Notes:
1. `name` stays CRM/dialog field; not part of search query.
2. `details/preferences` are allowed as extraction sources for canonical fields.
3. Explicitly excluded from selection contract for now: `distanceGolf`, `distanceAmenities`.

## 3) Front Contract (What Frontend Accepts)

Frontend card input contract for search/display path:

- Core: `id`, `operation`, `property_type`, `city`, `province`, `priceEUR`
- Specs: `rooms`, `bathrooms`, `area_m2`, `plot_m2`, `terrace_m2`, `has_parking`, `has_pool`
- Media: `image`, `imageGallery[]`, `tags[]`
- Text: `description`, `description_i18n`

Frontend display target:
1. Front card: location + status + icon metrics.
2. Back card: extended specs grid.
3. Query logic must use canonical fields only, not formatted labels.

## 4) Field-by-Field Link (Feed -> Front -> Insight -> Query -> Candidate)

| Business field | Feed/source | Front receives | Insight key | Query key | Candidate match rule |
|---|---|---|---|---|---|
| Rooms | `beds` / normalized `specs_rooms` | `rooms` | `rooms` | `rooms` | single: `candidate.rooms == query.rooms`; multi: `candidate.rooms IN query.rooms[]` |
| Bathrooms | `baths` / `specs_bathrooms` | `bathrooms` | `bathrooms` | `bathrooms` | `candidate.bathrooms >= query.bathrooms` |
| Operation | `price_freq` -> `sale/rent` | `operation` | `operation` | `operation` | `candidate.operation == query.operation` |
| Property type | `type/*` | `property_type` | `type` | `type` | mapped slug equality |
| Location | `town/province/location_detail` | `city/province/neighborhood` | `location` | `location` | normalized contains in city+district+neighborhood |
| Budget | `price` | `priceEUR` | `minPrice` | `minPrice` | `candidate.priceEUR >= minPrice` |
| Built area | `surface_area/built` | `area_m2` | `minArea` | `minArea` | `candidate.area_m2 >= minArea` |
| Plot area | `surface_area/plot` | `plot_m2` | `plotArea` | `plotArea` | `candidate.plot_m2 >= query.plotArea` |
| Floor | `floor` | `floor` | `floor` | `floor` | `candidate.floor == query.floor` |
| Parking | `parking` / tags/features | `has_parking` | `hasParking` | `hasParking` | boolean strict |
| Pool | `pool` / tags/features | `has_pool` | `hasPool` | `hasPool` | boolean strict |
| Terrace | `terrace` | `terrace_m2` / derived bool | `hasTerrace` | `hasTerrace` | `candidate.terrace_m2 > 0` |
| Orientation | `orientation` | `orientation` | `orientation` | `orientation` | normalized equality |
| Distance to beach | `distanceBeach + distanceBeachMed` | `distance_beach(_med)` | `distanceBeachKmMax` | `distanceBeachKmMax` | normalized to km, `<=` |
| Distance to airport | `distanceAirport + distanceAirportMed` | `distance_airport(_med)` | `distanceAirportKmMax` | `distanceAirportKmMax` | normalized to km, `<=` |
| Features/tags | `features[]/tags[]` | `tags[]` | `features[]` | `features[]` | all requested feature slugs must match candidate tags |

Location semantic note:
1. `city/province/micro-location` must be parsed as separate meanings even if stored in one insight field today.
2. `near_sea` is always feature semantics, never city/province/location.

## 5) Query Builder Contract (Target)

Input: canonical insights object.  
Output:
1. `preValidationQuery` (full candidate constraints from insights)
2. `postValidationQuery` (only valid/allowed fields)

Validation rules:
1. drop invalid types (ex: non-numeric rooms).
2. drop conflicting values (with explicit reason).
3. keep only supported fields for current search backend stage.

Budget guard (current product rule):
1. `operation=sale` -> accept budget only if `minPrice >= 10000`.
2. `operation=rent` -> accept budget only if `minPrice < 10000`.
3. invalid budget is dropped with explicit `droppedFields.reason`.

## 6) Candidate Builder Contract (Target)

1. Build candidate pool from DB using `postValidationQuery`.
2. Return ordered candidates with deterministic sort.
3. Attach lightweight `matchReport` for debug (which constraints passed/failed/skipped).
4. If strict result is empty, apply relaxed chain by dropping non-core constraints step-by-step.

Current relaxed drop order:
1. `hasParking`
2. `hasTerrace`
3. `distanceBeachKmMax`
4. `distanceAirportKmMax`
5. `hasPool`
6. `features`
7. `bathrooms`
8. `floor`
9. `orientation`

Minimum response shape (search path):
- `query`: post-validation query
- `cards`: matched candidates
- `totalMatches`
- `debug.matchSummary` (enabled in debug mode)

## 7) Canonical Example (2-room scenario)

User intent: "Хочу двухкомнатную квартиру".

Expected chain:
1. extraction: `rooms=2`, `type=apartment` (if detected)
2. canonical patch: `{ rooms: 2, type: 'apartment' }`
3. pre-validation query: `{ rooms: 2, type: 'apartment', ... }`
4. post-validation query: same (if valid)
5. candidates: only objects where `rooms = 2` and type matches.
6. frontend displays those cards with `rooms=2` on card metrics.

## 8) Implementation Phases

### Phase 1 (must-have)

1. Introduce one canonical query builder module in backend.
2. Route all search candidate generation through this module.
3. Apply selection fields from agreed set: `operation`, `type`, `location`, `rooms`, `bathrooms`, `minPrice`, `minArea`, `plotArea`, `floor`, `hasParking`, `hasPool`, `hasTerrace`, `orientation`, `distanceBeachKmMax`, `distanceAirportKmMax`, `features[]`.
4. Add pre/post query snapshots to debug.

### Phase 2

1. Tighten extraction quality for all 16 fields from real dialog cases.
2. Add per-field drop reasons.
3. Align frontend debug to backend query snapshots as source of truth.

### Phase 3

1. Expand with secondary fields (distance-based, year, etc.) if business-approved.
2. Optimize ranking after strict filter pass.

## 9) Definition of Done (for this contract)

System is considered aligned when:
1. one canonical query path is used for candidate search;
2. same input insights always produce same post-validation query;
3. candidate output is explainable against that query;
4. debug shows real runtime chain from insights to matched cards.
