# Execution Path Contract (Locked)

Last updated: 2026-04-30  
Branch: `Split`  
Status: mandatory runtime contract.

## Purpose

Freeze one deterministic selection path and explicitly forbid orchestration metadata from influencing search results.

## Single Source Execution Path

`user_input(text|audio) -> extraction -> insights -> canonical_patch -> pre_validation_query -> post_validation_query -> candidate_pool`

Rules:
1. Candidate search MUST be built only from `post_validation_query`.
2. `insights` is the only search input object.
3. Every mutation affecting search MUST be visible in query trace.

## Hard Prohibitions

The following fields/components are forbidden as search inputs:
1. `stage`
2. `role`
3. `meta.*`
4. handoff state (`handoff*`)
5. any UI mode/overlay flags

These values may exist for UX/logging only, but MUST NOT participate in:
1. canonical patch build
2. pre/post validation query build
3. candidate filtering and ranking

## Extraction Contract

1. Extraction writes only to `insights`.
2. Rewrite policy (current): fill-empty-only, no overwrite in same search cycle.
3. Runtime mode is explicit (`EXTRACTION_MODE`), and active mode MUST be returned in debug.

## Canonical Contract

1. Canonical layer reads only `insights`.
2. Canonical layer normalizes values to search-safe internal format.
3. Invalid fields are dropped with explicit reason in `droppedFields`.
4. Search policy is applied here (budget guards, softening, relaxed chain).
5. `rooms` may be scalar or array; filter semantics are `==` for scalar and `IN` for array.

## Debug Contract

Debug must show runtime truth, not inferred UI state:
1. source insights
2. canonical patch
3. pre-validation query
4. post-validation query
5. candidate count/ids
6. dropped/missing fields

Debug may show `stage/role/meta` only in separate `metadata` section clearly marked as non-search.

## Prompt Orchestration Lock

Main assistant runtime call uses only:
1. `BASE_SYSTEM_PROMPT`
2. `EXECUTION_LOCKED` instruction
3. language instruction
4. chronological `user/assistant` dialog history

Disabled from active main-call prompt path:
1. `RMV3_SERVER_FACTS_V1` system message
2. `RMV3_GUARDRAILS_V1` system message
3. `allowedFactsSnapshot` extra system instruction
4. `post-handoff` extra system instruction

Reason:
These layers are legacy orchestration/diagnostic context and can introduce behavioral noise unrelated to deterministic extraction/query contract.

## Acceptance Criteria

Contract is considered enforced when:
1. same `insights` always produce same `post_validation_query`;
2. changing `stage/role/meta` alone never changes candidate output;
3. debug trace proves query was derived exclusively from `insights`.

## Relation to Existing Docs

1. Target schema and field definitions: `docs/INSIGHTS_TARGET_CONTRACT.md`
2. Current state and extraction sources: `docs/INSIGHTS_AS_IS.md`
3. Legacy cleanup scope: `docs/LEGACY_CONTOUR.md`
4. Iteration plan: `docs/CURRENT_EXECUTION_PLAN.md`
