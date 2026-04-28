# Insights AS-IS (Estyle)

Last updated: 2026-04-28  
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
4. Main assistant call returns text and optional `---META---` block.
5. Backend parses META via `extractAssistantAndMeta(...)`:
   - merges `meta.clientProfileDelta` into `session.clientProfile`;
   - may set `session.stage` from `meta.stage`;
   - then maps profile back into insights via `mapClientProfileToInsights(...)`.
6. Backend returns response payload with `insights`, `stage`, `role`, `cards`, `ui`, `tokens`, `timing`, etc.
7. Frontend `api-client` consumes payload and updates `understanding` from `data.insights`.
8. Optional: frontend `loadSessionInfo()` imports stored server `insights`/`stage`/`role` from `/api/audio/session/:sessionId`.

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

### Source C: META -> `clientProfileDelta` (backend orchestration only)

- Trigger: assistant response includes `---META---` JSON.
- Type: LLM-guided profile delta + deterministic mapping.
- Fields touched:
  - `session.clientProfile` only (search path no longer mutates insights from META/profile).
- Notes:
  - kept for orchestration/debug; excluded from active search mutation path.

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

### meta

- Parsed from assistant output by `extractAssistantAndMeta(...)`.
- Used to update `clientProfile` and sometimes `stage`.
- Indirectly affects insights through profile->insights mapping.

### stage

- Session field initialized as `intro`.
- Updated by:
  - `determineStage(...)` (rule-based),
  - accepted `meta.stage` values (`intro`, `qualification`, `matching_closing`).
- Returned to frontend and visible in debug metadata.

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

Because of this, the final insight snapshot can differ between turns even for similar input.

## Determinization Target (next step, not implemented here)

To make behavior deterministic we need one strict write order and one source-of-truth layer, for example:
1. raw extraction snapshot,
2. canonical extraction mapper,
3. final applied insight state,
4. explicit query builder using approved fields only.

This document is AS-IS only; no runtime behavior changed in this iteration.
