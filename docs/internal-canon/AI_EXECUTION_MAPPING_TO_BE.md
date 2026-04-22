# AI_EXECUTION_MAPPING_TO_BE

Статус: target canon (to-be)  
Область: целевой deterministic mapping слоя AI -> execution  
Ограничение: документ не описывает реализацию, не меняет код и не добавляет новые execution-поля

---

## 1. Overview

Целевая модель:
- AI не является отдельным поисковым слоем.
- AI не является отдельным ranking engine.
- AI не является parallel mode к manual filters.
- AI — это механизм преобразования пользовательского запроса в execution-safe input.
- Истина по подборке определяется только execution engine.

Ключевая цель этого канона:
- зафиксировать единый, простой и deterministic путь `AI -> execution`;
- убрать размазанную модель распределённых мутаций как источник финальной истины.

---

## 2. Core architectural rule

**AI does not decide catalog truth. Execution decides catalog truth. AI only converts user intent into execution-safe input.**

Русская фиксация:
- AI не решает, какие карточки являются истинной выдачей.
- Execution engine определяет итоговый результат.
- AI только:
  1. извлекает параметры из пользовательского ввода,
  2. маппит их в допустимый execution-контракт,
  3. объясняет результат execution.

---

## 3. One mapping point principle

Целевое правило:

`User input -> AI understanding/extraction -> ONE mapping layer -> execution query -> execution engine -> UI result`

Требования:
- все AI-сигналы проходят через один mapping layer;
- только этот слой имеет право формировать execution query из AI-сигналов;
- вне этого слоя не должно быть источников final execution truth;
- mapping должен быть deterministic и повторяемым для одинакового входа.

Что устраняется на target-уровне:
- распределённые мутации AI-полей по нескольким независимым слоям как источник финального query;
- неявные конкурирующие пути формирования execution-значений.

---

## 4. Allowed execution-safe fields

AI имеет право формировать только поля, поддержанные текущим execution-контрактом.

Разрешённый набор execution-safe полей:
- `operation`
- `type`
- `district`
- `rooms`
- `smart`
- `minPrice`, `maxPrice`
- `minArea`, `maxArea`
- `minFloor`, `maxFloor`
- `floorNotFirst`, `floorNotLast`
- `rcOnly`, `residentialComplex`
- `arcadia`, `center`
- `parking`, `balconyLoggia`

Жёсткое ограничение:
- если поля нет в execution-контракте, AI не имеет права превращать его в реальный execution-фильтр.

---

## 5. Non-execution / semantic signals

Сигналы, не входящие в execution-контракт (например: «возле моря», «красивый ремонт», «тихий район», «для семьи», «инвестиционно интересно»), трактуются как semantic context.

Разрешено:
- понимать их в диалоге;
- хранить как secondary note;
- использовать для формулировок и уточнений.

Запрещено:
- превращать semantic сигналы в execution filters, если execution это не поддерживает явно.

Ключевая граница:
- semantic context не меняет catalog truth напрямую.

---

## 6. Mapping rules (AI -> execution)

Target-правила маппинга:

1. One contract
- AI маппится в тот же execution-контракт, что и manual filters.

2. One query model
- итоговый query после AI должен иметь ту же структуру и те же правила валидации, что manual query.

3. Deterministic normalization
- operation/type/location/numeric/boolean нормализация выполняется единообразно внутри единого mapping layer.

4. No hidden parallel query builders
- не допускаются дополнительные неканонические пути построения execution query для AI.

5. Execution-first validation
- если AI извлёк значение вне допустимого execution диапазона/формата, mapping layer приводит его к контрактно-допустимому виду или отбрасывает.

6. Manual-compatible output
- результат AI mapping должен быть функционально эквивалентен ручному вводу тех же полей.

---

## 7. Forbidden sources of truth

В target-модели источником финальной истины по query не могут быть:
- распределённые frontend heuristics вне mapping layer;
- backend/post-processing ветки вне mapping layer;
- отдельные side-effect мутации, не проходящие через единый mapping контракт;
- отдельный AI ranking как основание UI-выдачи;
- semantic поля как неявные execution-фильтры.

Жёстко:
- final execution truth формируется только через единый mapping layer + execution engine.

---

## 8. Regex / fallback / legacy role (to-be)

Regex/fallback/legacy в target-модели:

1. Не являются source of truth
- они не определяют финальный execution query как основной источник.

2. Могут существовать только как auxiliary mechanism
- допустимы как вспомогательные инструменты разбора входа.

3. Должны быть инкапсулированы в одном mapping layer
- если fallback применяется, он применяется внутри канонического mapping path.

4. Не имеют права на прямую distributed мутацию execution state
- вне mapping layer regex/fallback/legacy не должны менять execution query.

---

## 9. Manual filters compatibility

Target-совместимость manual и AI:
- manual filters и AI не являются двумя конкурирующими режимами поиска;
- AI обновляет тот же execution state, что и manual filters;
- execution engine, strict/relaxed логика и ranking остаются едиными;
- AI не создаёт отдельный «AI-поиск».

Ключевая формула:
- AI = альтернативный способ заполнить те же execution поля.

---

## 10. Overwrite policy (target principles)

Фиксируем target-принципы (без преждевременной детализации):

1. Deterministic overwrite
- перезапись execution-чувствительных полей должна быть предсказуемой и формально определённой.

2. No chaotic overwrite
- AI не должен бесконтрольно перетирать существующее execution state.

3. Manual authority must remain explicit
- ручное управление остаётся прозрачным и не должно проигрывать неявной AI-магии.

4. Field sensitivity awareness
- чувствительные поля (цена, комнаты, локация, RC) требуют более строгой политики перезаписи, чем вторичные сигналы.

5. Single-policy enforcement
- правила перезаписи применяются в одном mapping layer, а не в нескольких несогласованных местах.

---

## 11. Политика автообновления полей (initial safe version)

На ближайшем этапе фиксируется промежуточная safe-policy.

Общий принцип:
- AI не должен автоматически менять всё подряд.
- AI может автоматически обновлять только уточняющие параметры внутри уже текущей рамки поиска.
- AI пока не должен автоматически переключать базовый режим поиска там, где риск ложного переключения высокий.

Поля, которые разрешено автоматически коммитить в execution state:
- `district`
- `rooms`
- `minPrice`, `maxPrice`
- `minArea`, `maxArea`
- `floorNotFirst`, `floorNotLast`
- `rcOnly`
- `residentialComplex`
- `parking`
- `balconyLoggia`
- `arcadia`
- `center`
- `smart`

Поля, которые пока запрещено автоматически коммитить:
- `operation`
- `type`

Причина запрета на текущем этапе:
- это базовые переключатели режима поиска, и ошибка здесь даёт дорогой UX-эффект.
- вопрос «а дома есть?» не равен намерению «переключи поиск на дом».
- вопрос «что у вас есть в аренду?» не равен автоматической смене `operation` на `rent`.

Каноническая формулировка:
- AI обновляет только уточняющие параметры внутри текущего режима поиска, но не переключает автоматически базовый режим поиска, пока это отдельно не подтверждено продуктово и ручными тестами.

Правило перезаписи:
- новые значения из AI перезаписывают текущие значения execution state для разрешённых полей;
- manual изменения пользователя всегда имеют приоритет над AI.

---

## 12. Open questions / unresolved decisions

Сознательно не закрытые вопросы (нужны отдельные продуктовые решения):

1. Confirmation-before-override
- в каких случаях изменение `price/rooms/location/rc` требует подтверждения пользователя.

2. Price overwrite granularity
- когда AI может обновлять цену автоматически, а когда должен только предлагать изменение.

3. False numeric grabs protection
- как фильтровать неоднозначные числовые упоминания («я видел за 100к») без ложного перезаписывания фильтров.

4. Ambiguous location handling
- как различать район/микрорайон/ЖК/описательную локацию при неоднозначных формулировках.

5. RC interpretation policy
- где проходит граница между `residentialComplex` как строгим execution-полем и как semantic mention.

6. Overwrite aggressiveness
- уровень агрессивности AI-обновлений для уже заполненного execution state.

7. Legacy dictionaries/fallback scope
- какая часть legacy parsing должна остаться как вспомогательная внутри mapping layer.

---

## 13. Boundaries of this canon

Этот документ:
- задаёт целевую архитектуру именно AI->execution mapping;
- не описывает implementation roadmap;
- не меняет execution-канон;
- не добавляет новые execution-поля;
- не проектирует CRM/booking/stage-machine.

Жёсткая граница:
- AI не показывает «свои» карточки и не строит собственную выдачу.
- UI показывает результат execution engine.
- Target-архитектура — это упрощение и детерминизация, а не расширение числа автономных подсистем.
