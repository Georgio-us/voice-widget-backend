# AI_EXECUTION_MAPPING_AUDIT

Статус: as-is mapping audit  
Область: фактический путь данных AI -> execution в текущем runtime  
Ограничение: документ фиксирует наблюдаемое поведение кода; это не target-архитектура и не план изменений

---

## 1. Overview

Этот документ фиксирует текущий путь данных:

`user input -> AI extraction -> normalization -> fallback -> frontend merge -> effective query -> execution`

Цель:
- показать, как поля реально доходят (или не доходят) до execution;
- зафиксировать места мутаций, потерь, переопределений и флагозависимого поведения;
- не идеализировать систему.

Критично:
- в текущем runtime нет единого стабильного контракта `AI -> execution`;
- влияние AI на execution может быть полностью отключено режимом диагностики (`_catalogManualOnlyDiagnostics = true`), даже если extraction успешно обновляет insights/understanding.

---

## 2. End-to-end mapping flow

Фактический pipeline (as-is):

1. User input
- Источник: текст (`sendTextMessage`) или аудио (`sendMessage`) на frontend.
- Оба пути идут в `POST /api/audio/upload`.

2. LLM extraction (`insights_response`)
- Backend (`audioController.js`) вызывает OpenAI с JSON schema (`INSIGHTS_RESPONSE_SCHEMA`).
- Возвращает `assistant_text + insights`.
- При parse fail выполняется repair-call.

3. Backend normalization (`applyMetaInsightsToSession`)
- Значения из `meta.insights` парсятся/нормализуются (operation, budget, rooms, area, floor, features).
- Выполняются back-compat правила (`budget -> budgetMax`, `area -> areaMin`).
- Обновляется `session.insights`.

4. Backend fallback/post-processing
- `applyResidentialComplexFallbackFromTranscript(...)` может установить `insights.rcOnly`, `insights.residentialComplex`, `insights.residentialComplexOnly` из transcript regex.
- Эти поля не являются стабильным output основного schema extraction.

5. Frontend ingestion + understanding merge
- `ingestBackendCatalogPayload(data)` получает `data.insights`, прогоняет через `understanding.migrateInsights(...)`, затем `understanding.update(...)`.
- Understanding обновляется update-only merge (пустые/null не затирают заполненное).

6. Effective query assembly (frontend)
- `getCatalogEffectiveSearchParams(insightsSource)` собирает execution-query.
- Сначала base из understanding/AI, затем manual overrides (`merged = { ...base, ...manual }`).
- Есть дополнительные runtime-мутации (defaults, range fixups, arcadia/center -> primorsky, residentialComplex -> rcOnly).

7. Execution
- `refreshCatalogByEffectiveQuery()` отправляет query в `/api/cards/search`.
- Backend `/api/cards/search` применяет реальные hard filters и сортировку.

Ключевая мутация в runtime:
- при strict flow и `maxPrice` без `minPrice` frontend достраивает `minPrice = round(maxPrice * 0.7)` перед запросом.

---

## 3. Mapping entry points (sources of field updates)

Все текущие источники появления/изменения полей:

1. LLM schema extraction (`insights_response`)
- Основной источник `operation, budget, budgetMax, type, location, rooms, area, areaMin, areaMax, floor, features, details, preferences`.

2. Backend normalization (`applyMetaInsightsToSession`)
- Нормализует типы/форматы;
- может достраивать поля по back-compat правилам.

3. Backend regex/post-processing fallback
- `applyResidentialComplexFallbackFromTranscript` для `rcOnly/residentialComplex`.

4. Frontend understanding merge
- `migrateInsights` (legacy aliases) + `update` (update-only merge).

5. Frontend AI->query transformer
- `getCatalogEffectiveSearchParams`:
  - маппинг AI-полей в execution query,
  - feature token heuristics,
  - location/district normalization,
  - implicit defaults и fixups.

6. Manual filters overlay
- `normalizeCatalogFilterOverrides` даёт manual overrides;
- manual значения накладываются поверх AI/base.

7. Runtime flags
- `_catalogManualOnlyDiagnostics` и `_catalogIgnoreAssistantBaseFilters` могут полностью отключать влияние AI base на query.

8. Implicit/default behavior
- filter mode defaults (`operation=sale`, `type=apartment`),
- strict price autowindow `0.7 * max`.

---

## 4. Field-by-field mapping audit

### 4.1 Field: operation

Sources (as-is):
- LLM extraction: `insights.operation` (`buy|rent|null`).
- Backend normalize: `normalizeOperation` в `applyMetaInsightsToSession`.
- Frontend manual: `listingMode` (`sale|rent`).
- Legacy alias: frontend `operationType` -> `operation` в `migrateInsights`.

Transformation path:
- Backend хранит в session как `buy/rent`.
- Frontend `getCatalogEffectiveSearchParams` делает `normalizeOperationToSearch`: `buy/sale/... -> sale`, `rent -> rent`.

Normalization:
- operation seam: `buy` в AI против `sale` в execution.

Does it reach execution?
- Условно: да, только если AI-base не отключен runtime flags.
- Manual operation всегда доходит.

Mutation points:
- backend normalize;
- frontend normalize to search;
- filter-mode defaults могут подставить `sale`.

Overwrite behavior (as-is):
- manual overrides перезаписывают base (`merged = { ...base, ...manual }`).
- understanding update-only: null/empty не стирает существующее.

Ambiguities / risks:
- AI operation может быть корректно извлечен, но не участвовать в query при diagnostics mode.

Contract gaps:
- нет единого жёсткого контракта `buy/sale` между AI и execution слоями.

---

### 4.2 Field: type

Sources (as-is):
- LLM extraction `insights.type`.
- Backend normalize `normalizeType`.
- Frontend manual `propertyType`.
- Legacy alias: `propertyType` -> `type`.

Transformation path:
- backend session -> frontend understanding -> `normalizeTypeToSearch` -> `/api/cards/search?type=`.

Normalization:
- только ограниченный набор (`apartment|house|land|commercial`).

Does it reach execution?
- Условно: да (если AI-base не отключен), либо через manual.

Mutation points:
- normalize на backend;
- normalize на frontend;
- filter-mode default `type=apartment`.

Overwrite behavior (as-is):
- manual > AI/base.

Ambiguities / risks:
- в browse состояние `type` может визуально не быть выбран, но в filter mode default может появиться.

Contract gaps:
- отсутствует единый слой подтверждения overwrite между AI и manual.

---

### 4.3 Field: district / location

Sources (as-is):
- LLM extraction: только `location` (строка), не структурированный `district[]`.
- Frontend heuristics: `normalizeDistrictSlug(location)`.
- Frontend manual: `district` / `districtMulti`.
- Legacy alias: `district` -> `location` в understanding migration.

Transformation path:
- AI `location` -> slug district (single) на frontend;
- manual может быть multi-array;
- merged query уходит в `/api/cards/search`.

Normalization:
- district slug normalization (primorsky/kievsky/...).
- `arcadia/center=true` принудительно ставят `district=['primorsky']`.

Does it reach execution?
- AI location -> district: условно (если base не отключен и location распознан как район).
- manual district: да.

Mutation points:
- location parsing в frontend;
- district multi normalization;
- arcadia/center override.

Overwrite behavior (as-is):
- manual district перезаписывает base district.

Ambiguities / risks:
- location может интерпретироваться как район, ЖК или произвольный текст;
- single AI location против manual multi-district.

Contract gaps:
- у AI нет стабильного структурного district поля в schema.

---

### 4.4 Field: rooms

Sources (as-is):
- LLM extraction: `insights.rooms`.
- Backend normalize: `parseRoomsNumber`.
- Frontend manual: single/multi rooms.

Transformation path:
- AI rooms -> frontend parseNum -> `base.rooms` (`'4plus'` при >=4, иначе число как string).
- manual rooms -> `rooms[]` с токенами (`1,2,3,4,5plus`).

Normalization:
- backend может дать `0` для studio aliases;
- frontend в query поддерживает 1.. + plus-токены;
- choose-all для manual rooms превращается в пустой rooms-фильтр.

Does it reach execution?
- AI rooms: условно (если base не отключен).
- manual rooms: да.

Mutation points:
- backend parse;
- frontend token conversion;
- `smart=true` удаляет `rooms` из query перед execution (`delete query.rooms`).

Overwrite behavior (as-is):
- manual rooms перезаписывают base rooms.

Ambiguities / risks:
- AI studio (`0`) не имеет явного стабильного execution-трактования в strict filters;
- режим smart снимает обязательность rooms в runtime.

Contract gaps:
- single numeric AI rooms и multi-token execution rooms не имеют единой строгой спецификации.

---

### 4.5 Field: smart

Sources (as-is):
- Нет core-schema поля `smart`.
- Frontend feature parser (`features/details/preferences/location`) может выставить `smart=true`.
- Manual checkbox `smart`.

Transformation path:
- текстовые токены -> base.smart;
- merge с manual -> execution query;
- в `refreshCatalogByEffectiveQuery` при smart удаляется rooms.

Normalization:
- boolean via heuristic token match.

Does it reach execution?
- Да для manual;
- условно для AI (если base не отключен).

Mutation points:
- feature token parser;
- `smart` special rule (rooms removed from query).

Overwrite behavior (as-is):
- manual smart перезаписывает base smart.

Ambiguities / risks:
- heuristic-based извлечение (false positive/negative).

Contract gaps:
- нет formal LLM schema-контракта для smart.

---

### 4.6 Field: minPrice / maxPrice

Sources (as-is):
- LLM extraction: `budget`, `budgetMax`.
- Backend normalize: `parseBudgetNumber` + back-compat `budget -> budgetMax`.
- Frontend manual: `priceFrom/priceTo`.

Transformation path:
- AI budget/budgetMax -> frontend `base.maxPrice` (из `budgetMax ?? budget`).
- manual -> `minPrice/maxPrice`.
- strict autowindow может достроить `minPrice=round(maxPrice*0.7)`.

Normalization:
- shorthand, UAH->USD в backend parser;
- numeric cleanup на frontend.

Does it reach execution?
- manual: да;
- AI: условно (если base не отключен).

Mutation points:
- backend parse currency/amount;
- frontend numeric parser;
- strict autowindow;
- guard: if min>max then max=min.

Overwrite behavior (as-is):
- manual min/max перезаписывают AI-derived values.

Ambiguities / risks:
- false numeric grab из контекста может стать budget;
- AI не даёт явного minPrice, только через derived logic.

Contract gaps:
- mapping budget semantics -> execution maxPrice неявный и режимный.

---

### 4.7 Field: area (min/max)

Sources (as-is):
- LLM extraction: `area`, `areaMin`, `areaMax`.
- Backend normalize: `parseNumeric`; back-compat `area -> areaMin`.
- Manual: `areaFrom/areaTo`.

Transformation path:
- AI areaMin/area -> `minArea`; AI areaMax -> `maxArea`.

Normalization:
- numeric parse; invalid -> null.

Does it reach execution?
- manual: да;
- AI: условно.

Mutation points:
- backend numeric parse;
- frontend numeric parse;
- range fixup if min>max.

Overwrite behavior (as-is):
- manual overrides wins.

Ambiguities / risks:
- area text parsing может терять контекст (например формулировка не как число).

Contract gaps:
- нет подтверждения overwrite для чувствительных чисел.

---

### 4.8 Field: floor (min/max / flags)

Sources (as-is):
- LLM extraction: `floor`.
- Backend normalize: `parseFloorNumber` (число или текстовое значение вроде not first/not last/high/mid/low).
- Manual: `floorFrom/floorTo`, `floorNotFirst`, `floorNotLast`.

Transformation path:
- AI floor в execution query маппится как exact: `minFloor=floor`, `maxFloor=floor` только если floor парсится числом на frontend.
- Text floor preferences из AI обычно не становятся execution floor flags.

Normalization:
- frontend `parseNum` берет только цифры.

Does it reach execution?
- AI numeric floor: условно да.
- AI text floor preferences (`not first/not last/high/mid/low`): в execution обычно нет.
- manual floor/flags: да.

Mutation points:
- backend parseFloorNumber;
- frontend parseNum (может отрезать смысловые floor-теги).

Overwrite behavior (as-is):
- manual floor fields перезаписывают base.

Ambiguities / risks:
- потеря floor preference semantics между backend insights и frontend execution query.

Contract gaps:
- нет стабильного AI->execution маппинга для floor flags.

---

### 4.9 Field: parking

Sources (as-is):
- LLM schema не имеет отдельного parking field.
- Frontend feature token parser (`features/details/preferences/location`).
- Manual checkbox.

Transformation path:
- token -> `base.parking=true` -> merged query -> `/api/cards/search?parking=true`.

Normalization:
- regex/keyword heuristics.

Does it reach execution?
- manual: да.
- AI: условно.

Mutation points:
- token parser;
- manual overwrite.

Overwrite behavior (as-is):
- manual parking приоритетнее.

Ambiguities / risks:
- semantic leakage: свободный текст может случайно активировать parking.

Contract gaps:
- нет formal schema-level parking поля.

---

### 4.10 Field: balconyLoggia

Sources (as-is):
- Аналогично parking: через feature heuristics или manual checkbox.

Transformation path:
- token -> `balconyLoggia=true` -> execution query.

Normalization:
- regex/keyword heuristics (`балкон/лоджия/balcony/loggia`).

Does it reach execution?
- manual: да.
- AI: условно.

Mutation points:
- heuristic parser;
- manual overwrite.

Overwrite behavior (as-is):
- manual > base.

Ambiguities / risks:
- false positive на текстовых упоминаниях.

Contract gaps:
- нет отдельного schema поля.

---

### 4.11 Field: rcOnly

Sources (as-is):
- Не core-schema поле.
- Backend transcript fallback (`applyResidentialComplexFallbackFromTranscript`).
- Frontend feature token parser (`rcOnly` signal из текста).
- Frontend manual checkbox (`residentialComplexOnly`).
- Frontend derived rule: если `residentialComplex` задан, принудительно `rcOnly=true`.

Transformation path:
- может появиться на backend insights fallback;
- может появиться/усилиться на frontend;
- уходит в execution как boolean filter.

Normalization:
- regex and marker detection.

Does it reach execution?
- Да, но источник значения неоднородный (manual / fallback / heuristic).

Mutation points:
- backend regex fallback;
- frontend feature parser;
- frontend implied rule from residentialComplex.

Overwrite behavior (as-is):
- manual и implied derivation могут переопределить отсутствие rcOnly.

Ambiguities / risks:
- execution-важный флаг формируется не только из LLM schema.

Contract gaps:
- `rcOnly` не имеет чистого schema-контракта AI extraction.

---

### 4.12 Field: residentialComplex

Sources (as-is):
- Не core-schema поле extraction.
- Backend transcript regex fallback может выставить.
- Frontend может вывести из `location` при RC markers.
- Manual RC picker/hidden field.

Transformation path:
- любой источник -> `merged.residentialComplex` -> execution query.
- затем derived rule: `rcOnly=true`.

Normalization:
- strip RC prefixes (`ЖК/...`), text cleanup.

Does it reach execution?
- Да, если значение непустое.

Mutation points:
- backend fallback set;
- frontend derivation from location;
- manual overwrite.

Overwrite behavior (as-is):
- manual value перезаписывает base/derived value.

Ambiguities / risks:
- одно поле может приходить из нескольких несовпадающих путей;
- возможна потеря/искажение названия при эвристической очистке.

Contract gaps:
- нет стабильного, единственного AI-schema источника для RC.

---

### 4.13 Field: arcadia

Sources (as-is):
- Нет отдельного core-schema arcadia поля.
- Frontend feature parser из text tokens.
- Manual checkbox.

Transformation path:
- `arcadia=true` -> merged query;
- side effect: `district=['primorsky']` forced.

Normalization:
- token match (`аркад|arcad`).

Does it reach execution?
- manual: да.
- AI: условно.

Mutation points:
- token parser;
- district force override.

Overwrite behavior (as-is):
- manual arcadia и related district override приоритетнее base district.

Ambiguities / risks:
- arcadia flag может конфликтовать с исходной AI location;
- конфликт решается принудительным district override.

Contract gaps:
- нет формального schema-поля.

---

### 4.14 Field: center

Sources (as-is):
- Нет отдельного core-schema center поля.
- Frontend feature parser из text tokens.
- Manual checkbox.

Transformation path:
- `center=true` -> merged query;
- side effect: `district=['primorsky']` forced.

Normalization:
- token match (`центр|center|central`).

Does it reach execution?
- manual: да.
- AI: условно.

Mutation points:
- token parser;
- district override.

Overwrite behavior (as-is):
- manual > base.

Ambiguities / risks:
- конфликт center/location также решается принудительным district override.

Contract gaps:
- нет формального schema-поля.

---

## 5. Mutation layers (cross-field view)

Слои мутаций данных (по порядку):

1. Extraction layer (LLM schema)
- первичное заполнение `insights`.

2. Backend normalization layer
- парсинг типов/чисел/operation/type/features;
- back-compat автодостройка (`budgetMax`, `areaMin`).

3. Backend fallback layer
- transcript regex для RC-полей (`rcOnly`, `residentialComplex`).

4. Frontend understanding migration/merge
- legacy key migration;
- update-only merge (non-empty overwrite only).

5. Frontend effective-query transformer
- AI text -> execution flags;
- location -> district;
- defaults/derived rules (`sale`, `apartment`, `residentialComplex -> rcOnly`, `arcadia/center -> primorsky`).

6. Manual override layer
- manual filters накладываются поверх base.

7. Runtime filter-mode logic
- может подставлять defaults при активном filter mode;
- strict price autowindow и range fixups.

8. Execution endpoint normalization (`/api/cards/search`)
- массивы/токены/boolean parsing на backend;
- реальный hard filtering и сортировка.

Вывод:
- данные проходят несколько преобразований, нет одношагового mapping.

---

## 6. Dangerous mappings (as-is)

1. False numeric grab
- текстовый контекст может быть распознан как budget/число и попасть в query как price constraint.

2. Overwrite existing fields without explicit confirmation
- новые non-empty значения могут затирать предыдущие через merge цепочку (особенно при повторных сообщениях).

3. Semantic leakage
- `details/preferences/location` через heuristics могут включать execution флаги (`smart`, `parking`, `balconyLoggia`, `rcOnly`, `arcadia`, `center`).

4. Buy vs sale seam
- AI extraction использует `buy`, execution использует `sale`; преобразование не унифицировано на одном слое.

5. Regex-derived execution fields
- `rcOnly/residentialComplex` могут появляться из regex fallback, а не из schema extraction.

6. Location ambiguity
- одно поле `location` может значить район, микрорайон, ЖК, общий текст; разные ветки трактуют по-разному.

7. Sometimes-applied / sometimes-ignored behavior
- при `_catalogManualOnlyDiagnostics=true` AI insights обновляются, но в execution query могут не участвовать вовсе.

---

## 7. Confirmation gaps (as-is)

Где сейчас нет confirm-before-overwrite:

1. Цена (`budget/budgetMax -> maxPrice`)
- новое извлечение может изменить ценовой фильтр без отдельного подтверждения.

2. Комнаты (`rooms`)
- новое значение rooms может перезаписать прошлое через merge, если не пустое.

3. Локация (`location -> district / residentialComplex`)
- неоднозначные формулировки могут приводить к смене трактования без шага подтверждения.

4. Feature-derived flags (`parking/balcony/smart/arcadia/center/rcOnly`)
- при token-совпадениях флаги могут включиться без явного пользовательского подтверждения.

5. RC-поля
- fallback regex может добавить `rcOnly/residentialComplex` без подтверждения.

Риск:
- чувствительные фильтры меняются не только явным выбором пользователя, но и цепочкой extraction/fallback/heuristics.

---

## 8. Legacy / dead / suspicious paths

1. Двойной ranking контур
- backend AI ranking (`topCandidates`) и frontend execution ranking живут независимо.

2. Partial AI->catalog integration
- extraction/understanding может работать отдельно от execution query из-за runtime diagnostics flags.

3. RC fallback path outside schema
- execution-важные RC поля идут через regex/post-processing.

4. Legacy key migration in frontend understanding
- поддержка `operationType/propertyType/district` добавляет дополнительные ветки маппинга.

5. Feature heuristics as implicit mapper
- execution flags могут появляться из свободного текста, минуя явные структурные поля.

6. Client-profile side path (backend)
- `mapClientProfileToInsights` также мутирует insights перед applyMeta, что добавляет ещё один источник изменений.

Observed/suspicious:
- в текущей архитектуре нет одного слоя, который бы единолично и детерминированно отвечал за final mapping всех AI полей в execution query.

---

## 9. As-is conclusion

Стабильнее всего маппятся:
- manual filters -> execution query;
- базовые numeric ranges, когда задаются вручную;
- operation/type в strict-manual flow.

Нестабильнее маппятся:
- location (как свободный текст AI),
- RC-поля,
- feature-derived flags,
- floor semantic preferences.

Главные источники ошибок:
- многослойные мутации без единого контракта;
- fallback/heuristics для execution-важных полей;
- flag-driven отключение AI влияния на execution при сохранении AI extraction активности.

Самая сильная зависимость системы:
- от runtime flags и fallback-веток, а не от единого формального AI->execution контракта.
