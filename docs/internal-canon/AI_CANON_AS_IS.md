# AI_CANON_AS_IS

Статус: active source of truth (as-is)  
Область: текущая фактическая логика AI-слоя (backend + frontend understanding)  
Ограничение: документ фиксирует только то, что реально происходит в коде сейчас, включая несогласованности

---

## 1. Overview

AI-слой сейчас рабочий, но не цельный как единый чистый модуль.

Фактически он состоит из нескольких пересекающихся частей:
1. transcription (audio -> text),
2. extraction (LLM -> insights JSON),
3. session-level post-processing и fallback-логики,
4. backend AI ranking (`topCandidates`),
5. frontend understanding state.

Критичный факт:
- AI и execution разделены не полностью.
- AI-слой НЕ является execution engine.
- AI-слой в текущей системе выполняет вспомогательную роль.
- Финальное поведение каталога определяется execution runtime, а не фактом extraction.
- Часть связей между слоями управляется runtime flags и fallback-ветками, а не единым стабильным контрактом.

---

## 2. Entry points / pipeline (end-to-end)

Фактический линейный путь:
1. `POST /api/audio/upload`.
2. Вход:
   - audio -> Whisper transcription,
   - text -> direct path.
3. До main LLM:
   - reference pipeline (детектор, fallback classifier, ambiguity/clarification state, guards).
4. Main LLM extraction:
   - `gpt-4o-mini`,
   - `response_format=json_schema` (`insights_response`).
5. Parse / repair:
   - parse structured JSON,
   - при parse fail: repair-call с тем же schema.
6. apply insights в session:
   - нормализация значений,
   - back-compat авто-заполнение,
   - transcript regex fallback для некоторых полей.
7. backend ranking:
   - hard gates по insights,
   - scoring,
   - `topCandidates`, `totalMatches`, `strictMatches`, `relaxedMatches`.

Observed:
- pre-LLM reference/guard слой большой и legacy-heavy.
- extraction и ranking формально в одном backend контуре, но semantic и execution смыслы смешиваются.

---

## 3. LLM contract (schema)

Main extraction schema: `insights_response`.

Top-level required:
- `assistant_text`
- `insights`

`insights` required keys:
- `name`
- `operation`
- `budget`
- `budgetMax`
- `type`
- `location`
- `rooms`
- `area`
- `areaMin`
- `areaMax`
- `floor`
- `features`
- `details`
- `preferences`

### 3.1 Core extraction fields (as-is)
- `operation` (`buy|rent|null`)
- `type` (`apartment|house|land|commercial|null`)
- `budget`, `budgetMax`
- `rooms`
- `location`
- `area`, `areaMin`, `areaMax`
- `floor`
- `features`

### 3.2 Non-core semantic fields (as-is)
- `details`
- `preferences`

### 3.3 Runtime-important fields outside strict schema center
- `residentialComplex`
- `rcOnly` / `residentialComplexOnly`

Фактический источник таких полей:
- regex/fallback/post-processing, не основной schema extraction путь.

Критичный факт:
- `residentialComplex` и `rcOnly` не входят в разрешённый `insights_response` schema output для main LLM extraction.
- execution-важные значения по этим полям в runtime часто формируются не через schema extraction, а через fallback/post-processing.
- LLM не является единственным и гарантированным источником этих значений.

---

## 4. Insights -> Session normalization

После extraction данные не идут напрямую в query.  
Сначала применяется слой нормализации в backend (`applyMetaInsightsToSession` и связанные helper-функции).

Фактические преобразования:
- operation normalization (`buy/rent`),
- budget parsing (включая shorthand и UAH->USD conversion),
- rooms parsing (numeric + aliases),
- area/floor parsing,
- features tokenization + heuristics.

Back-compat автоматика:
- если нет `budgetMax`, но есть `budget`, то `budgetMax` достраивается.
- если нет `areaMin`, но есть `area`, то `areaMin` достраивается.

Ключевой факт:
- AI output != final execution query.
- между ними всегда есть mutation/post-processing слой.

---

## 5. AI -> Search contract (as-is reality)

На текущий момент нет жёстко зафиксированного единого AI->execution контракта.

Фактическое состояние:
- AI insights не имеют стабильного и единого контракта с execution.
- при `_catalogManualOnlyDiagnostics = true` AI insights могут полностью НЕ участвовать в формировании catalog query.
- AI extraction может обновлять understanding state и при этом не менять выдачу.
- часть сигналов доходит в execution только через fallback/side logic.
- влияние AI на execution не гарантировано и зависит от runtime flags.

Что наблюдается в коде:
- operation/type/rooms/budget/location/area/floor/features могут участвовать в effective query только в определённых runtime-режимах,
- это поведение не является безусловным и зависит от active flags/режима,
- `residentialComplex` и `rcOnly` имеют заметную долю regex/post-processing происхождения,
- semantic поля (`details/preferences`) не имеют жёсткого и предсказуемого правила трансляции в execution filters.

Итог:
- контракт частичный, слоистый и зависимый от runtime состояния.
- это не стабильная единая схема “AI fields -> execution fields”.

---

## 6. Backend AI ranking

Backend AI ranking существует и считается на каждом проходе `audio` pipeline:
- candidate source: общий normalized pool properties,
- hard gates по insights,
- scoring (`score`, `strictScore`, `matchTier`),
- результат: `topCandidates` + match counters.

Score weights (as-is):
- rooms: 34
- budget: 20
- area: 10
- floor: 10
- parking: 13
- balcony: 13

Критично:
- backend AI ranking (`topCandidates`) не является source of truth для frontend каталога.
- в текущей runtime-конфигурации frontend каталог может полностью игнорировать порядок backend AI ranking.
- система не имеет единого обязательного ranking слоя.
- наличие `topCandidates` в ответе не означает применение этого порядка в UI-выдаче.

---

## 7. Frontend Understanding layer

`UnderstandingManager` хранит extraction state локально во frontend:
- `name`, `operation`, `budget`, `budgetMax`, `type`, `location`, `rooms`,
- `area`, `areaMin`, `areaMax`, `floor`,
- `features`, `details`, `preferences`,
- `residentialComplex`, `progress`.

Фактическое поведение:
- update-only merge (пустые/null не должны затирать заполненное),
- legacy key migration (`operationType`, `propertyType`, `district` и т.д.).

Ключевой факт:
- understanding state может обновляться, даже когда AI вообще не влияет на фактический execution query каталога.

---

## 8. Frontend vs Backend separation (partial)

Backend:
- transcription,
- extraction,
- session normalization,
- AI ranking counters + candidates.

Frontend:
- manual filters,
- effective query сборка,
- strict/relaxed catalog runtime.

Фактический характер разделения:
- разделение есть, но неполное,
- пересечения есть,
- интеграция местами частичная и режимная.

Observed:
- frontend может работать в manual/diagnostics контуре, где AI insights не подмешиваются как базовые фильтры.
- в этом контуре extraction и understanding обновляются, но execution query может оставаться полностью manual.

---

## 9. Runtime flags affecting AI behavior

Флаги сейчас не просто “настройки”, а фактические переключатели поведения системы:

- `_catalogManualOnlyDiagnostics = true`
  - вручную изолирует manual execution от AI base merge.
- `_catalogIgnoreAssistantBaseFilters`
  - контролирует, подмешивается ли assistant/understanding слой в effective query.
- superadmin gating
  - расширенный debug payload виден не всем.

Ключевой факт:
- runtime flags фактически переопределяют поведение системы.
- flags могут отключать влияние AI независимо от extraction результата.
- текущее поведение определяется flags сильнее, чем формальными контрактами между слоями.

---

## 10. Contract seams / integration risks

Фактические швы:
1. operation seam: `buy` (AI extraction) vs `sale` (execution search).
2. schema seam: execution-важные сущности (`residentialComplex`, `rcOnly`) не являются чистым ядром schema extraction.
3. ranking seam: backend AI ranking и frontend catalog ranking независимы.
4. integration seam: AI->catalog интеграция частичная и флагозависимая.
5. fallback seam: часть значений приходит через regex/post-processing, а не через формальный schema-контракт.

Критично:
- LLM extraction и execution поля не образуют единую гарантированную контрактную цепочку.

---

## 11. Known behaviors (observed)

Observed:
1. AI извлекает больше сигналов, чем затем реально используется execution-контуром.
2. Часть extracted полей может не влиять на выдачу при active diagnostics/manual isolation.
3. Backend `topCandidates` и frontend каталог могут показывать разный приоритет карточек.
4. Fallback/post-processing может менять практический эффект без отдельного формального контракта на эти изменения.
5. В текущем runtime-режиме AI extraction может не участвовать в query при одновременно обновляемом understanding.

Правило интерпретации:
- observed behavior не равен гарантированному decision rule.
- observed эффекты нельзя трактовать как право менять execution hard boundaries.

---

## 12. Boundaries of this canon

Этот документ:
- фиксирует AI as-is,
- не описывает target архитектуру,
- не является AI_CANON_TO_BE,
- не задаёт новые execution правила.

Граница:
- AI_CANON_AS_IS не даёт права трактовать текущие side-effects как продуктовый целевой контракт.

---

## 13. System inconsistencies (as-is)

Системные несогласованности, зафиксированные в текущей реализации:

1. Dual ranking without single source of truth  
   - backend считает AI ranking (`topCandidates`),  
   - frontend живёт по собственному catalog strict/relaxed runtime,  
   - единого обязательного ranking source нет,  
   - порядок backend ranking не обязателен для UI.

2. Schema mismatch with runtime-critical fields  
   - `residentialComplex` / `rcOnly` важны для execution поведения,  
   - но их происхождение часто fallback/regex/post-processing, а не чистый schema path.

3. Partial AI->catalog integration  
   - интеграция неполная и режимная,  
   - часть путей AI отключается/обходится при diagnostics режиме,  
   - extraction/understanding могут работать при нулевом влиянии на query.

4. Flag-driven behavior dominates architecture  
   - текущий эффект AI на поиск определяется флагами,  
   - flags могут полностью отключить AI-влияние на каталог,  
   - поведение определяется флагами сильнее, чем контрактами слоёв.

5. Mixed legacy layers in single runtime path  
   - reference/clarification/shortlist/no-guessing контур и extraction/ranking контур связаны в одном большом потоке,  
   - что усложняет однозначную интерпретацию причин изменения итогового поведения.

Итоговый as-is вывод:
- система рабочая, но многослойная и местами несогласованная;
- единый жёсткий AI execution контракт на текущем этапе отсутствует.
