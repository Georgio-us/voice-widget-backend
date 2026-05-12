# FINAL_SCOPE

Last updated: 2026-05-12  
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

## Final scope to improve next

### 1) Operation robustness (rent/sale)
- Reduce cases where explicit rent/sale intent is lost (`operation=null`) on natural user phrasing.
- Keep deterministic priority:
  - explicit rent terms -> rent
  - explicit sale terms -> sale
  - fallback behavior remains allowed when explicit signal is absent.

### 2) Unsupported coast behavior
- Prevent unsupported coastal geo phrases (e.g., `Costa del Sol`) from silently becoming broad `near_sea` inventory search.
- If geo is unsupported and no supported geo is provided in same intent:
  - respond clearly with coverage boundaries,
  - route to manager CTA,
  - avoid misleading “selection updated” behavior.

## Explicitly out of scope (for this checkpoint)

- Refactoring large legacy layers.
- Aggressive NLP heuristics expansion.
- Any lead-blocking policy.
- Reworking current CRM reference mapping that already demonstrates stable delivery.

