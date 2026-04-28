# Legacy Contour (Search vs Orchestration)

Last updated: 2026-04-28
Branch: `Split`
Status: boundary document for cleanup decisions.

## Why This File Exists

Current system mixes two layers:

1. Search layer (must be deterministic).
2. Orchestration/diagnostic layer (dialog state, telemetry, old flow controls).

This file marks what belongs to each layer.

## Search-Critical (keep in execution path)

1. `insights` fields used for filtering.
2. Canonical normalization (`canonicalQueryV1`).
3. Post-validation query.
4. Candidate matching and ordering.

These directly affect which property cards user gets.

## Orchestration/Legacy (not part of search decision)

1. `stage`
2. `role`
3. META-driven dialog state transitions
4. Reference fallback diagnostics and debug trace events
5. Historical sprint-specific markers (`mode`, legacy UI gating states)

These can stay for dialog UX/logging, but must not change filtering output.

## Direct Answer: What `stage/meta/role` give today

They currently give:

1. dialog flow hints (intro/qualification/etc.);
2. response metadata to frontend/debug;
3. extra logging/trace context.

They do **not** need to be used as filter inputs for property selection.

## Cleanup Direction

1. Freeze search path to: `insights -> canonical query -> candidates`.
2. Keep orchestration metadata isolated in response/debug only.
3. Remove any coupling where `stage/meta/role` alters search query.

## Legacy Removal Log

### Iteration 1 (2026-04-26)

Removed from active search mutation path:

1. Periodic GPT analysis trigger each 5 user messages.
2. META/clientProfile sync step that rewrote `session.insights`.

Still present (non-search, to clean later in slices):

1. `stage` lifecycle fields and transitions.
2. `role` propagation to frontend/debug.
3. META parsing and profile updates for orchestration/logging.
4. Reference fallback and debug trace infrastructure.

### Iteration 2 (2026-04-26)

Removed from active UX/debug contract:

1. Progress percentage usage in debug extraction history.
2. Progress-based status logic in details/context screen update flow.

Search-related cleanup:

1. Backend extraction no longer recalculates/persists `insights.progress`.

### Iteration 3 (2026-04-26)

Removed from active extraction strategy:

1. Valencia-only location regex dictionary as primary location source.

Replaced with:

1. Feed-driven location lexicon (loaded from DB rows, cached).
2. Thin alias layer for common RU variants (Torrevieja/Calpe/Alicante/etc).

### Iteration 4 (2026-04-28)

Extraction path hardened:

1. Added runtime extraction mode switch: `rules | llm | hybrid`.
2. In active environment, extraction is now `llm`-first and no-overwrite.
3. Added extraction trace in API/debug (`mode`, `appliedFields`).

### Iteration 5 (2026-04-28)

Canonical guards and relaxed behavior:

1. Budget leak protection by operation:
   - sale budgets below `10000` dropped from query;
   - rent budgets above/equal `10000` dropped from query.
2. Added core softening (`*0.8`) for `minPrice`, `minArea`, `plotArea`.
3. Added relaxed fallback chain when strict result is empty.
4. Added `queryTraceV1.relaxed` for visibility of dropped relaxed filters.

## Practical Decision For Next Iterations

1. No full deletion required in one step.
2. First objective: enforce zero impact of orchestration fields on candidate filtering.
3. After that, prune legacy branches safely in small slices.
