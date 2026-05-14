# Architecture Example (Canonical Search Flow)

Last updated: 2026-05-14
Branch: `Split`
Status: current architecture summary for deterministic selection and UI events.

## Goal

Define one linear path from user request to candidate cards, without hidden side-flows.

## Canonical Scenario

1. Client sends message (voice or text).
2. System converts input to text (voice -> transcription, text -> raw text).
3. Extraction reads text and fills agreed search fields (up to 16 fields).
4. Filled values are written into `insights` state using deterministic `fill/rewrite` patch policy.
5. Canonical mapper normalizes `insights` into one search-safe query object.
6. Filter engine applies this query to properties dataset.
7. Candidate pool is produced and ordered.
8. Backend returns `queryTraceV1`, optional cards, and optional explicit `ui.systemEvent`.
9. Frontend renders explicit UI event first; otherwise it can infer selection CTA from `matchedCount`.
10. New user constraints narrow, widen, or redirect the same search state on next turns.

## Entities In Chain

1. `input_text`
2. `extraction`
3. `insights`
4. `canonical_patch`
5. `post_validation_query`
6. `candidate_pool`
7. `ui.systemEvent`
8. `rendered_cards`

## Required Rule

Search behavior must depend only on extracted/normalized business fields (rooms, budget, location, features, etc.), not on dialog orchestration metadata.

## Rewrite Rule (Current Runtime)

1. Field present in extraction patch -> write/overwrite this field in `insights`.
2. Field absent in extraction patch -> preserve previous value.
3. Array fields (`features`, `locationsRaw`, `rooms[]`) are replaced, not merged.
4. Query is rebuilt from updated insights every turn.

## Pricing/Area Rule (Current Iteration)

Current deterministic rule:

1. Budget range extraction supports `minPrice` and `maxPrice`.
2. Area from extraction is mapped to `minArea` only.
3. Candidate filter uses:
   - `price >= minPrice`
   - `price <= maxPrice` when upper bound is explicit
   - `area >= minArea`
4. `minPrice` is softened by `*0.8`; `maxPrice` is strict.
5. `operation` defaults to `sale` when unresolved.

## Geo/UI Rule (Current Runtime)

1. Supported geo rewrite -> update query and selection CTA.
2. Mixed supported + unsupported geo -> keep supported tokens, drop unsupported tokens.
3. Initial unsupported-only geo -> broad catalog fallback selection CTA.
4. Initial broad geo (`Spain/Испания/España`) -> broad catalog fallback selection CTA.
5. Unsupported geo after prior supported/limited matched context -> manager CTA.
6. No-new-insights turn -> manager CTA.

## Example (2-room)

1. User says: "Хочу двухкомнатную квартиру".
2. Extraction sets: `rooms = 2`, `type = apartment` (if detected).
3. Insights store these values.
4. Query builder produces: `{ rooms: 2, type: 'apartment' }`.
5. Candidate engine returns only matching objects.
6. User adds new constraint (e.g. terrace) -> query is narrowed on next turn.

## Current Fit To Code

Implemented now:

1. Canonical query module exists (`services/canonicalQueryV1.js`).
2. Candidate execution via canonical query exists (`findBestProperties` -> `executeCanonicalQueryV1`).
3. Debug already shows chain snapshots (`queryTraceV1`).
4. Backend-owned explicit UI events exist for manager CTA.
5. Frontend prioritizes explicit `ui.systemEvent` above inferred selection events.

Still not fully clean:

1. Multiple insight writers still mutate state in one request lifecycle.
2. Legacy orchestration code remains in `audioController.js`, but should not affect candidate filtering.
3. `/interaction` can reuse session candidate queues; latest `/upload` trace remains search source of truth.

## Iteration Log

### Iteration 1 (2026-04-26)

Applied:

1. Canonical query switched from `maxPrice/maxArea` to `minPrice/minArea`.
2. Candidate filtering switched to `>=` logic for price and area.
3. Periodic GPT re-analysis every 5 messages disabled.
4. META -> clientProfile -> insights mutation removed from active path.

Result:

Search path is now closer to target deterministic chain (`text -> extraction -> insights -> canonical -> candidates`).

### Iteration 2 (2026-04-26)

Applied:

1. Budget extraction improved for shorthand formats (`100k`, `100к`, `100 тыс`).
2. Insight `progress` removed from active backend extraction state.
3. Debug/UX no longer uses progress-based percentage logic in active path.

Result:

Debug chain focuses on business fields only; budget shorthand is normalized more reliably for query building.

### Iteration 3 (2026-04-26)

Applied:

1. Candidate pool is now built on every turn (not only on explicit `show` intent).
2. `queryTraceV1` now carries candidate ids for deterministic debug pool visibility.
3. Location extraction switched from Valencia-specific regex list to feed-driven lexicon (DB + aliases).

Result:

`Candidate pool` in debug is available as soon as at least one meaningful insight is extracted, and location matching is aligned with feed locations.
