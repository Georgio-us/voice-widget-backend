# Execution Path Contract (Locked)

Last updated: 2026-05-14  
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
2. Rewrite policy (current): deterministic field-level `fill/rewrite`.
3. If a field is present in current extraction patch, it is updated (rewritten).
4. If a field is absent in current extraction patch, existing value is preserved.
5. Array fields (`features`, `locationsRaw`, `rooms[]`) use `replace` (no merge).
6. Runtime mode is explicit (`EXTRACTION_MODE`), and active mode MUST be returned in debug.

## Canonical Contract

1. Canonical layer reads only `insights`.
2. Canonical layer normalizes values to search-safe internal format.
3. Invalid fields are dropped with explicit reason in `droppedFields`.
4. Search policy is applied here (budget guards, softening, relaxed chain).
5. `rooms` may be scalar or array; filter semantics are `==` for scalar and `IN` for array.
6. `operation` default is `sale` when unresolved/empty.
7. If `operation=rent` conflicts with sale-range budget (`>=10000`), operation is reset (dropped) and default `sale` applies.
8. Unknown multi-location token sets from `locationsRaw` MUST NOT pass as free-text `location` filter.
9. Budget semantics are interpreted before query build:
   - `X-Y` / `от X до Y` => `minPrice + maxPrice`
   - `до X` => `maxPrice`
   - `от X` => `minPrice`
   - single number `X` => `minPrice` (current product rule)
10. `minPrice` softening (`*0.8`) remains enabled; `maxPrice` is strict (no softening).

## Geo Selection Contract

Geo is part of canonical search policy, not prompt-only behavior.

Statuses:
1. `supported`: requested geo is in active catalog scope.
2. `limited`: known limited area; do not promote, but do not deny categorically.
3. `unsupported`: requested geo is outside active catalog scope or unknown.
4. `broad`: broad market geo such as `Spain/Испания/España`.

Runtime rules:
1. `supported_geo_rewrite` -> update effective query and emit selection results.
2. `mixed_supported_unsupported` -> keep supported tokens, drop unsupported tokens with reason `unsupported_location_tokens_ignored`, emit selection results.
3. `unsupported_initial_search` -> drop unsupported location with reason `unsupported_location_catalog_fallback`, use broad catalog fallback, emit selection results.
4. `broad_initial_search` -> drop broad location with reason `broad_location_catalog_fallback`, use broad catalog fallback, emit selection results.
5. `unsupported_after_supported_search` -> do not silently fallback to previous/broad catalog; emit manager CTA.
6. Coastal intent (`near sea`, `возле моря`, `на берегу`, `побережье`, `cerca del mar`) maps to `features[]=near_sea`, never to `location` or `orientation`.

The distinction between initial fallback and manager escalation is session-aware:
`unsupported_after_supported_search` is true only when previous `queryTraceV1` had supported/limited geo, effective geo filter, and matched candidates.

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
3. `GEO_FACTS_V1` dynamic system message built from current `queryTraceV1`
4. language instruction
5. chronological `user/assistant` dialog history

Disabled from active main-call prompt path:
1. `RMV3_SERVER_FACTS_V1` system message
2. `RMV3_GUARDRAILS_V1` system message
3. `allowedFactsSnapshot` extra system instruction
4. `post-handoff` extra system instruction

Reason:
These layers are legacy orchestration/diagnostic context and can introduce behavioral noise unrelated to deterministic extraction/query contract.

## UX Manager Escalation Contract

Manager CTA is backend-owned. Frontend must render explicit `ui.systemEvent` above any inferred `matchedCount` selection action.

Backend emits `ui.systemEvent={type:'action', action:'open_manager'}` when:
1. current message produced no new extracted fields (`no_new_insights`);
2. current message has manager/schedule/legal/mortgage/installment/process intent;
3. current geo is unsupported after a previous supported/limited search context.

When user message is outside direct selection update scope (legal flow, mortgage/installments, process details):
1. Assistant gives a short, non-committal informational answer.
2. Assistant explicitly mentions the UX path: user can press `Связаться с менеджером` button below.
3. Backend must guarantee the button via `ui.systemEvent`; this is not a frontend heuristic.
4. Manager escalation UX MUST NOT mutate `insights` by itself.

Selection CTA is also explicit/inferred from runtime trace:
1. If backend provides `ui.systemEvent`, frontend renders it and does not infer another action from stale `matchedCount`.
2. If no explicit event exists and `queryTraceV1.matchedCount > 0`, frontend may emit `open_results`.
3. A previous valid candidate pool must not block `open_manager` for a no-new-insights turn.

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
