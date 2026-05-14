# FINAL_SCOPE

Last updated: 2026-05-14  
Branch: `Split`

## Product stance before production handoff

System is considered production-ready for its core role:
- navigate user through property search,
- provide object selection flow,
- transfer to manager via lead submission.

Known AI imperfections are accepted (speech recognition noise, ambiguous phrasing, edge semantic drift), as long as business-critical flow remains stable.

## Locked decisions

1. **Do not block lead submissions.**  
   Under no condition should lead delivery be hard-blocked by strict validation in object/manager flow.

2. **Do not touch current REF delivery flow (works now).**  
   Current object reference propagation to CRM is considered stable enough and must remain unchanged in this scope.

3. **`widget_in_dialog` is not treated as an active product entity for UX planning.**  
   If legacy traces remain in code, they are not part of current business flow and must not be used as basis for product decisions.

## Final Runtime Scope

### 1) Selection execution path
- Runtime candidate selection follows:
  `input -> extraction -> insights -> canonicalQueryV1 -> queryTraceV1 -> candidates -> ui.systemEvent`.
- Search query is derived from `insights` only.
- `stage`, `role`, handoff state, and UI overlay state are not search inputs.

### 2) Operation robustness (rent/sale)
- Keep deterministic priority:
  - explicit rent terms -> rent
  - explicit sale terms -> sale
  - fallback behavior remains allowed when explicit signal is absent.
- Rental policy is explicit in assistant behavior: **only short-term/daily rental is supported**.

### 3) Geo behavior
- Supported geo rewrite -> selection results.
- Mixed supported + unsupported geo -> supported selection results; unsupported tokens are dropped with reason.
- Initial unsupported-only geo -> broad catalog fallback, not empty dead-end.
- Initial broad geo (`Spain/Испания/España`) -> broad catalog fallback.
- Unsupported geo after prior supported/limited search context -> manager CTA.
- Coastal phrases map to `features.near_sea`, not `location` or `orientation`.

### 4) Manager escalation
- Backend owns manager CTA via explicit `ui.systemEvent=open_manager`.
- `no_new_insights`, legal/mortgage/process/schedule intent, and unsupported-after-supported geo must render manager CTA.
- Old candidate pools or stale `matchedCount` must not block manager CTA.

### 5) Language/output consistency
- Response language must follow user language (`ru`/`en`/`es`) consistently, including Spanish turns.

### 6) Multi-room stability
- Phrases like `1 и 2 комнаты` / `1 or 2 bedrooms` / `1 y 2 habitaciones` must stay multi-select and not collapse to single room value.

## Explicitly out of scope (for this checkpoint)

- Refactoring large legacy layers.
- Aggressive NLP heuristics expansion.
- Any lead-blocking policy.
- Reworking current CRM reference mapping that already demonstrates stable delivery.
