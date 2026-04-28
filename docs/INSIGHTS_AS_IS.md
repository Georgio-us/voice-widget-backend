# Insights AS-IS (Estyle)

Last updated: 2026-04-28 (post legacy-cleanup milestone)  
Branch: `Split`  
Scope: current runtime behavior without refactor.

## Goal

Document the current (as-is) insight pipeline and make it deterministic for further cleanup.

This file captures:
1. where insights come from now;
2. which sources currently mutate insight state (`extractions_current`);
3. what is actually used to form candidate selection/query;
4. where `meta/stage/mode` are involved today.

## Current Insight Shape (canonical target)

`session.insights` (backend + frontend understanding target):
- `name`
- `operation`
- `budget`
- `type`
- `location`
- `rooms`
- `area`
- `details`
- `preferences`

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
- Fields touched: all insight fields (`name`, `operation`, `budget`, `type`, `location`, `rooms`, `area`, `details`, `preferences`) + `progress` recalculation.
- Notes:
  - extraction logic is multilingual and keyword-based;
  - many fields are set only if currently empty (`if (!insights.<field>)`).

### Source B: Schema-first LLM extraction (backend)

- Trigger: same request path inside `runExtractionPipeline(...)`.
- Type: probabilistic (LLM JSON extraction with strict key sanitization).
- Fields touched: target insight fields, fill-empty only (no-overwrite policy).
- Notes:
- no-overwrite policy blocks rewrites of already filled fields.

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
  - does not extract new facts, only maps keys and recalculates `progress`.

## What Actually Forms Candidate Selection (AS-IS)

Important: current production selection is not fully driven by all 9 insights.

### Backend ranking (`findBestProperties` / `scoreProperty`)

Current scoring uses:
- `insights.rooms`
- `insights.location` (district normalization)
- `insights.budget`
- plus static bonus for city `Valencia`

Not currently used in score:
- `operation`, `type`, `area`, `details`, `preferences`, `name`.

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

### mode

- No single canonical “mode” currently controls card-query execution.
- In old/other products mode/relaxed/manual pipelines existed; in current Estyle runtime they are not the source of truth.
- What exists now in debug is metadata (`source`, `requestType`, payload `stage`) and history events, not a deterministic query mode engine.

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
