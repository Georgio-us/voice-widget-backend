# Phase 1 Finalization (AI -> Execution Safe Integration)

## 1. Legacy commit-path audit (AS-IS)

### Canonical path (confirmed)
Основной путь формирования final execution query:

1. `insights` (from `UnderstandingManager.export()` or explicit `insightsSource`)
2. `buildCanonicalAiPatch(insights)`
3. merge with manual overrides in `getCatalogEffectiveSearchParams(...)`
4. final request build in `refreshCatalogByEffectiveQuery(...)`
5. `/api/cards/search` через `api.fetchCardsSearch(requestQuery)`

Ключевые точки:
- `buildCanonicalAiPatch`: `Voice-Widget-Frontend/voice-widget-v1.js`
- `getCatalogEffectiveSearchParams`: `Voice-Widget-Frontend/voice-widget-v1.js`
- `refreshCatalogByEffectiveQuery`: `Voice-Widget-Frontend/voice-widget-v1.js`

### What can still feed insights (allowed as input)
- Backend normalization (`applyMetaInsightsToSession`) и transcript fallback (включая RC/floor flags) в `audioController.js`.
- Legacy/fallback данные обновляют `session.insights`/frontend understanding.

Это считается **input layer**, а не direct final-query commit.

### Potential bypasses / risks
1. `APIClient.dispatchHiddenCommand -> fetchCardsSearch(args)` существует как legacy path.
   - По текущему коду визуальный показ через этот путь изолирован (комментарии Sprint I, без рендера карточек в основной каталог).
   - Риск: если этот путь снова начнут использовать как UI-driving, появится обход canonical flow.
2. Backend по-прежнему считает собственный AI ranking (`topCandidates`), но frontend execution-каталог не обязан его использовать.
   - Это не bypass final query, но это отдельный слой, который может путать диагностику.

Вывод по п.1: для текущего execution каталога canonical path не нарушен; legacy ветки остаются как auxiliary/input.

---

## 2. Phase 1 Contract (short)

### Pipeline (short)
`User input (text/audio) -> insights extraction/normalization -> buildCanonicalAiPatch -> manual merge -> final execution query -> /api/cards/search -> execution results`

### Safe fields (AI auto-commit allowed)
- `district`
- `rooms`
- `minPrice`, `maxPrice`
- `minArea`, `maxArea`
- `floorNotFirst`, `floorNotLast`
- `rcOnly`
- `residentialComplex` (только после валидации по RC catalog)
- `parking`
- `balconyLoggia`
- `arcadia`
- `center`
- `smart`

### Restricted fields (AI auto-commit forbidden)
- `operation`
- `type`

### Priority rule
- `manual > AI`
- Ручные фильтры перезаписывают AI patch для тех же полей.

### Source of truth
- Истина по выдаче: execution backend (`/api/cards/search`) + текущий execution runtime (strict/relaxed).
- AI не является отдельным execution/ranking engine для каталога.

---

## 3. Phase 2 Backlog (not in scope now)

1. Overwrite policy v2
- Чёткие правила add/replace/remove для каждого поля.
- Явные правила when-to-confirm для рискованных перезаписей.

2. Ambiguous intent rules
- Вопросы типа “а аренда есть?” vs реальная смена режима.
- “А дома есть?” vs смена `type`.

3. Extraction quality hardening
- Edge-cases для `arcadia/center/smart`.
- Улучшение multi-value extraction устойчивости для сложных фраз.

4. Numeric edge-cases
- False numeric grabs.
- Контекстные числа (“видел за 100к”, “этажность дома”, “площадь кухни”) без ложного коммита.

5. Confirm / follow-up policy
- Когда система должна уточнять перед изменением уже установленного фильтра.

6. Legacy/fallback cleanup (optional, later)
- Сужение legacy веток, которые могут усложнять трассировку.
- Оставить только clearly auxiliary parsers.

7. Final assistant prompt policy
- Короткий, deterministic interaction style.
- Без “agentic realtor” поведения вне execution/object scope.

