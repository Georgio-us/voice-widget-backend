# Architecture Example (Canonical Search Flow)

Last updated: 2026-04-30
Branch: `Split`
Status: target execution model for deterministic AI-only selection.

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
8. Frontend renders candidates as cards.
9. New user constraints narrow or widen the same pool on next turns.

## Entities In Chain

1. `input_text`
2. `extraction`
3. `insights`
4. `canonical_patch`
5. `post_validation_query`
6. `candidate_pool`
7. `rendered_cards`

## Required Rule

Search behavior must depend only on extracted/normalized business fields (rooms, budget, location, features, etc.), not on dialog orchestration metadata.

## Rewrite Rule (Current Runtime)

1. Field present in extraction patch -> write/overwrite this field in `insights`.
2. Field absent in extraction patch -> preserve previous value.
3. Array fields (`features`, `locationsRaw`, `rooms[]`) are replaced, not merged.
4. Query is rebuilt from updated insights every turn.

## Pricing/Area Rule (Current Iteration)

Current deterministic rule:

1. Budget from extraction is mapped to `minPrice` only.
2. Area from extraction is mapped to `minArea` only.
3. Candidate filter uses:
   - `price >= minPrice`
   - `area >= minArea`
4. `maxPrice/maxArea` are intentionally not used in this phase.
5. `operation` defaults to `sale` when unresolved.

## Example (2-room)

1. User says: "Хочу двухкомнатную квартиру".
2. Extraction sets: `rooms = 2`, `type = apartment` (if detected).
3. Insights store these values.
4. Query builder produces: `{ rooms: 2, type: 'apartment' }`.
5. Candidate engine returns only matching objects.
6. User adds new constraint (e.g. terrace) -> query is narrowed on next turn.

## Current Fit To Code

Partially implemented now:

1. Canonical query module exists (`services/canonicalQueryV1.js`).
2. Candidate execution via canonical query exists (`findBestProperties` -> `executeCanonicalQueryV1`).
3. Debug already shows chain snapshots (`queryTraceV1`).

Not deterministic yet:

1. Multiple insight writers still mutate state in one request lifecycle.
2. Legacy orchestration fields still flow through response/log pipeline.

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
