# Insights AS-IS (Estyle)

Last updated: 2026-04-30 (post deterministic rewrite + location contract hardening)  
Branch: `Split`  
Scope: current runtime behavior without refactor.

## Goal

Document the current (as-is) insight pipeline and make it deterministic for further cleanup.

This file captures:
1. where insights come from now;
2. which sources currently mutate insight state (`extractions_current`);
3. what is actually used to form candidate selection/query;
4. where `meta/stage/mode` are involved today.

## Current Insight Shape (runtime)

`session.insights` (backend + frontend understanding target):
- `operation`
- `type`
- `location`
- `locationsRaw`
- `rooms`
- `bathrooms`
- `budget`
- `area`
- `plotArea`
- `floor`
- `hasParking`
- `hasPool`
- `hasTerrace`
- `orientation`
- `distanceBeach`
- `distanceAirport`
- `features`
- `details`
- `preferences`
- `name`

Backend initializes this shape in `controllers/audioController.js` (`getOrCreateSession`).
Frontend keeps the same shape in `modules/understanding-manager.js`.

## End-to-End AS-IS Flow

1. User message arrives to `POST /api/audio/upload` (`routes/audioRoute.js` -> `transcribeAndRespond`).
2. Backend writes user message into in-memory session and calls `updateInsights(sessionId, transcription)`.
3. `runExtractionPipeline(...)` selects extraction mode:
   - `rules` -> `updateInsights(...)` only,
   - `llm` -> schema-first LLM extraction only,
   - `hybrid` -> LLM then rules.
4. Main assistant call returns plain assistant text (META orchestration ignored in execution path).
5. Backend returns response payload with `insights`, `cards`, `ui`, `tokens`, `timing`, `queryTraceV1`, `extraction`.
6. Frontend `api-client` consumes payload and updates `understanding` from `data.insights`.
7. Optional: frontend `loadSessionInfo()` imports stored server `insights` from `/api/audio/session/:sessionId`.

## extractions_current

Current insight mutations come from multiple independent sources.

### Source A: Rule/Regex extraction in `updateInsights(...)` (backend)

- Trigger: every `/api/audio/upload` user message.
- Type: deterministic pattern extraction.
- Fields touched: legacy subset; acts as fallback in `rules/hybrid` only.
- Notes:
  - extraction logic is multilingual and keyword-based;
  - many fields are set only if currently empty (`if (!insights.<field>)`).

### Source B: Schema-first LLM extraction (backend)

- Trigger: same request path inside `runExtractionPipeline(...)`.
- Type: probabilistic (LLM JSON extraction with strict key sanitization).
- Fields touched: full runtime insight shape.
- Notes:
  - policy is deterministic `fill/rewrite` (field present in patch rewrites; field absent is untouched);
  - array fields (`features`, `locationsRaw`, `rooms[]`) are `replace`, not merge.

### Source C: META / Stage / Role orchestration

- Status: excluded from active execution path.
- Notes:
  - kept only as legacy internals where still present in code;
  - no longer used as runtime inputs to query/candidate path;
  - not returned in primary runtime payload contract.

### Source D: Session hydration on frontend (`loadSessionInfo`) 

- Trigger: frontend initialization / session restore.
- Type: server snapshot import.
- Fields touched: all insights via `migrateInsights(...)` + `update(...)`.
- Notes:
  - keeps frontend state aligned with backend in-memory session.

### Source E: Frontend normalization layer (`migrateInsights`) 

- Trigger: any incoming insights object before applying to UI state.
- Type: key alias normalization only.
- Examples:
  - `operationType` -> `operation`
  - `propertyType` -> `type`
  - `district` -> `location`
  - `locationDetails` -> `details`
  - `additional` -> `preferences`
- Notes:
  - does not extract new facts.

## What Actually Forms Candidate Selection (AS-IS)

Important: current production selection is driven by canonical query execution path.

### Backend candidate execution (`findBestProperties` -> `executeCanonicalQueryV1`)

Current runtime selection uses canonical fields from `postValidationQuery`, including:
1. `operation` (default `sale` if unresolved)
2. `type`
3. `cities[]` (primary) / `location` (fallback)
4. `province` fallback
5. `rooms` (`==` scalar or `IN` array)
6. `minPrice`, `minArea`, `plotArea` (with `0.8` softening)
7. relaxed chain for non-core constraints when strict result is empty.

### Canonical location/feature behavior (current)

1. canonical location source priority is `locationsRaw -> location`.
2. Canonical layer converts coast-like phrases (`возле моря`, `near sea`, `cerca del mar`, `coast`) into `features.near_sea`.
3. Coast-like phrases are excluded from `location` filter token.
4. Explicit unknown multi-location token sets are dropped from query (`droppedFields.reason=unknown_location_tokens`) instead of leaking as free-text location.
5. This mapping is active in runtime query path and visible in debug (`location extraction` + `location parsing` + `canonicalPatch.features`).

### Feed reality constraint (current estyle dataset)

1. Raw feed snapshot in DB does not expose separate `town/province/location_detail/costa` keys in `raw`.
2. Effective geo source for runtime is normalized DB columns:
   - `location_city`
   - `location_district` (used as province-level field in current mapping)
   - `location_neighborhood`
3. Because of this, location semantics must be reconstructed at canonical level (city/province/location parsing) rather than read directly from `raw` keys.

### Interaction flow (`POST /api/audio/interaction`)

- Builds/uses `session.lastCandidates` from ranked list (or full DB fallback).
- `next` iterates by queue + `shownSet` mechanics.
- This means user sees candidate queue behavior, not strict filter query behavior.

### Frontend debug query (`buildCanonicalPatch`, `getEffectiveSearchParams`)

- Exists in `modules/debug-menu.js`.
- Produces debug-only “effective query” snapshot from insights.
- Used for diagnostics/reporting, not as authoritative backend search contract.

## meta / stage / mode AS-IS

### meta / stage / role

- Status: removed from execution contract and runtime payload contract.
- `insights -> canonical -> queryTraceV1 -> candidates` is the active source-of-truth chain.
- Legacy internals may still exist in code but are non-execution.

### Assistant prompt stack (runtime)

Current active assistant prompt stack is intentionally minimal:
1. base personality prompt
2. execution lock instruction
3. language instruction
4. user/assistant dialog history

Disabled in active main-call path:
1. RMV3 server facts system message
2. RMV3 guardrails system message
3. allowed-facts injected system block
4. post-handoff injected system block

### mode

- No single canonical “mode” currently controls card-query execution.
- In old/other products mode/relaxed/manual pipelines existed; in current Estyle runtime they are not the source of truth.
- What exists now in debug is metadata (`source`, `requestType`, payload `stage`) and history events, not a deterministic query mode engine.

## Current Canonical Business Guards (AS-IS)

1. `operation` defaults to `sale` when unresolved.
2. If extracted `operation=rent` conflicts with sale-range budget (`>=10000`), operation is reset and default `sale` is used.
3. Budget guard:
   - `sale` accepts only `minPrice >= 10000`;
   - `rent` accepts only `minPrice < 10000`;
   - invalid budget is dropped with explicit reason.

## Why System Is Not Deterministic Yet

Multiple writers update insights in one flow:
1. regex/rules,
2. GPT extraction,
3. META client profile mapping,
4. frontend session hydration/normalization.

Current determinism baseline is improved:
1. extraction updates insights;
2. canonical builds query from insights;
3. stage/role/meta do not alter query path.

## Determinization Target (next step, not implemented here)

To make behavior deterministic we need one strict write order and one source-of-truth layer, for example:
1. raw extraction snapshot,
2. canonical extraction mapper,
3. final applied insight state,
4. explicit query builder using approved fields only.

This document is AS-IS only; no runtime behavior changed in this iteration.
