# AI_CANON_TO_BE

Статус: target canon (to-be)
Область: целевая архитектура AI-слоя как conversational/input механизма
Ограничение: документ не описывает реализацию, не меняет execution-канон, не добавляет новые execution-поля

---

## 1. Overview

Целевая модель:
- AI не является отдельным слоем принятия решений по каталогу.
- AI не является отдельным поисковым или ranking-движком.
- AI работает как conversation/input interface.
- AI переводит пользовательский запрос в допустимые execution-поля.
- Исполнение поиска и truth по карточкам определяет только execution engine.

Жёсткая граница:
- UI показывает execution results.
- AI не «показывает свои карточки» и не подменяет execution truth.

---

## 2. Core architectural rule

**AI does not decide catalog truth. Execution decides catalog truth. AI only converts user intent into execution-safe inputs and explains execution outputs.**

Русская фиксация:
- AI не принимает финальные решения по каталогу.
- Истина по выдаче определяется execution engine.
- AI только:
  1. преобразует пользовательское намерение в execution-safe вход,
  2. объясняет уже полученный execution-результат.

---

## 3. Allowed extraction fields (execution-safe only)

AI имеет право выставлять только поля, поддержанные текущим execution-контрактом (как в CURRENT_EXECUTION_CANON).

Целевой принцип:
- один контракт для manual и AI,
- AI не создаёт параллельный набор filter fields,
- AI не добавляет новые execution-поля.

Execution-safe поля (контрактные):
- `operation`
- `type`
- `district` (single/multi)
- `rooms` (single/multi)
- `smart`
- `minPrice`, `maxPrice`
- `minArea`, `maxArea`
- `minFloor`, `maxFloor`
- `floorNotFirst`, `floorNotLast`
- `rcOnly`, `residentialComplex`
- `arcadia`, `center`
- `parking`, `balconyLoggia`

Правило:
- если поле не поддерживается execution-контрактом, AI не использует его как реальный фильтр.

---

## 4. Non-execution user signals

Пользовательские сигналы вне execution-полей (например: «возле моря», «для семьи», «красивый ремонт», «тихий район», инвестиционные пожелания) трактуются как conversational context.

Разрешено:
- понимать эти сигналы,
- хранить как secondary notes/preferences,
- использовать в формулировках объяснений и уточняющих вопросов.

Запрещено:
- превращать такие сигналы в execution filters, если execution их не поддерживает,
- менять catalog truth на их основе.

---

## 5. Update rule (no stage-machine)

Целевое правило обновления:
- AI не живёт stage-driven моделью.
- Каждый новый валидный insight, который входит в execution-контракт, может обновлять execution state.
- AI не обязан проходить «этапы» qualification/handoff/booking.

Ограничение:
- AI не вводит собственную сложную сценическую логику как источник управления поиском.

---

## 6. Forbidden AI behavior

AI не должен:
1. выдумывать объекты, которых нет в execution results;
2. утверждать отсутствие объектов без подтверждения execution;
3. использовать semantic-пожелания как реальные фильтры вне execution-контракта;
4. строить отдельный ranking слой;
5. комментировать как факт поля, которые execution не гарантирует;
6. вести себя как полноценный риелтор/сделочный агент;
7. инициировать отдельный business-process handoff от имени AI слоя;
8. конкурировать с manual filters как «второй режим поиска».

---

## 7. Response style / delivery rule

Целевой стиль AI:
- короткие, интерфейсные, конкретные реплики;
- минимум сервисного шума;
- уточняющие вопросы — только по делу и коротко;
- фокус на параметрах и результате execution.

Не целевой стиль:
- длинные разговоры ради разговора,
- «болтливый риелторский» тон,
- лишние эмоциональные формулы без операционной пользы.

---

## 8. Out-of-scope questions

Если запрос вне object/execution scope (сложная инвестиционная аналитика, юридические заключения, ипотечные расчёты, вопросы, не выводимые надёжно из execution-контракта), AI:
- не импровизирует как эксперт;
- не выдаёт неподтверждённые профессиональные выводы;
- коротко обозначает границу компетенции;
- может направить к действию через «Связаться».

Ограничение:
- этот канон не проектирует handoff workflow, только фиксирует границу компетенции AI.

---

## 9. Manual filters compatibility

Целевое правило совместимости:
- manual filters и AI не являются конфликтующими режимами.
- AI обновляет тот же execution state, что и ручной ввод.
- manual filters остаются каноническим и прозрачным интерфейсом управления подборкой.
- AI не должен произвольно переопределять execution state вне допустимого контракта.

Итог:
- переходы manual <-> AI трактуются как работа с одним и тем же execution-контрактом.

---

## 10. Open questions / design risks (not resolved here)

Следующие вопросы зафиксированы как открытые и не решаются в этом документе:
1. Политика перезаписи already-known fields (overwrite policy).
2. Когда AI обновляет цену автоматически, а когда должен запрашивать подтверждение.
3. Защита от ложного извлечения чисел из контекста (false numeric grabs).
4. Судьба legacy regex dictionaries и границы их применения.
5. Степень агрессивности overwrite существующих insights.
6. Где нужен confirmation-before-override, а где нет.
7. Обработка ambiguous числовых ссылок (например: «я видел квартиру за 100 тысяч»).
8. Что фиксируется жёстко каноном, а что остаётся зоной manual testing.

Правило:
- эти пункты не закрываются догадками в AI_CANON_TO_BE.
- окончательная политика по ним принимается отдельно и затем канонизируется.

---

## 11. Boundaries of this canon

Этот документ:
- задаёт целевую роль AI в текущем продукте,
- не меняет execution rules,
- не добавляет новые execution fields,
- не является roadmap или implementation plan,
- не проектирует CRM/admin архитектуру.

Жёсткая граница:
- execution engine остаётся единственным source of truth по выдаче каталога.
