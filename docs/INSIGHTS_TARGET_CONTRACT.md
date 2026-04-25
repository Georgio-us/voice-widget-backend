# Insights Target Contract (TO-BE)

Last updated: 2026-04-25  
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

### Canonical types

- `operation`: enum `sale | rent`
- `type`: slug enum (`apartment`, `villa`, `townhouse`, `penthouse`, `commercial`, ...)
- `city`: string slug/text (normalized comparison form)
- `province`: string slug/text
- `rooms`: integer
- `bathrooms`: integer
- `maxPrice`: integer (EUR)
- `maxArea`: integer (`m2`)
- `plotArea`: integer (`m2`)
- `hasParking`: boolean
- `hasPool`: boolean
- `hasTerrace`: boolean
- `orientation`: enum/text normalized (`north`, `south`, `east`, `west`, `ne`, ...)

### Normalization principles

1. Numbers: strip symbols and parse to numeric type.
2. Booleans: map `yes/true/1` -> `true`, `no/false/0` -> `false`.
3. Enums/slugs: map multilingual labels to one internal value.
4. Text locations: keep source text but also compute normalized compare form.

## 2) Insights We MUST Collect

Target insight schema (AI-only):

- `operation` (sale/rent)
- `type`
- `location.city`
- `location.province`
- `rooms`
- `bathrooms` (optional but supported)
- `budget.maxPrice`
- `area.maxArea`
- `features.hasParking`
- `features.hasPool`
- `features.hasTerrace`
- `timeline.urgency` (dialog only; not mandatory for query)

Notes:
1. `name` stays CRM/dialog field; not part of search query.
2. `details/preferences` remain optional free-text and are not allowed to bypass canonical filters.

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
| Rooms | `beds` / normalized `specs_rooms` | `rooms` | `rooms` | `rooms` | `candidate.rooms == query.rooms` |
| Bathrooms | `baths` / `specs_bathrooms` | `bathrooms` | `bathrooms` | `bathrooms` (phase 2) | `candidate.bathrooms >= query.bathrooms` or exact (to decide) |
| Operation | `price_freq` -> `sale/rent` | `operation` | `operation` | `operation` | `candidate.operation == query.operation` |
| Property type | `type/*` | `property_type` | `type` | `type` | mapped slug equality |
| City | `town` | `city` | `location.city` | `city` | normalized contains/equality |
| Province | `province` | `province` | `location.province` | `province` | normalized equality |
| Budget | `price` | `priceEUR` | `budget.maxPrice` | `maxPrice` | `candidate.priceEUR <= maxPrice` |
| Built area | `surface_area/built` | `area_m2` | `area.maxArea` | `maxArea` | `candidate.area_m2 <= maxArea` |
| Plot area | `surface_area/plot` | `plot_m2` | optional | `plotMin/plotMax` (phase 3) | range match |
| Parking | `parking` / tags/features | `has_parking` | `features.hasParking` | `hasParking` | boolean strict |
| Pool | `pool` / tags/features | `has_pool` | `features.hasPool` | `hasPool` | boolean strict |
| Terrace | `terrace` | `terrace_m2` / derived bool | `features.hasTerrace` | `hasTerrace` | `terrace_m2 > 0` or boolean |

## 5) Query Builder Contract (Target)

Input: canonical insights object.  
Output:
1. `preValidationQuery` (full candidate constraints from insights)
2. `postValidationQuery` (only valid/allowed fields)

Validation rules:
1. drop invalid types (ex: non-numeric rooms).
2. drop conflicting values (with explicit reason).
3. keep only supported fields for current search backend stage.

## 6) Candidate Builder Contract (Target)

1. Build candidate pool from DB using `postValidationQuery`.
2. Return ordered candidates with deterministic sort.
3. Attach lightweight `matchReport` for debug (which constraints passed/failed/skipped).

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
3. Apply strict fields: `operation`, `type`, `city/province`, `rooms`, `maxPrice`, `maxArea`, `hasParking`, `hasPool`, `hasTerrace`.
4. Add pre/post query snapshots to debug.

### Phase 2

1. Add bathrooms/plot/orientation filters where reliable.
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

