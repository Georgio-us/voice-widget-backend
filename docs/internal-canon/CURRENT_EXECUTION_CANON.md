# CURRENT_EXECUTION_CANON

Статус: active source of truth (as-is)
Область: текущая фактическая логика frontend/runtime поиска и фильтрации
Ограничение: документ фиксирует только наблюдаемое поведение текущего кода

---

## 1. Overview

Система сейчас работает как единый runtime с двумя фазами:
1. `browse/filter` логика формирования effective query.
2. `strict -> relaxed` выдача карточек при исчерпании текущего окна.

Текущая реализация:
- strict-выборка строится через `/api/cards/search`.
- relaxed-подгрузка работает в runtime и добавляет карточки порциями.
- relaxed не прыгает фокусом на новую карточку слоя автоматически.

Observed behavior:
- на маленьком каталоге widest слой может визуально резко отличаться от предыдущих шагов.
- это может быть следствием малого пула кандидатов, а не дефектом ранжирования.

---

## 2. Runtime flags / state

Ключевые runtime-флаги (frontend):
- `_catalogStrictOnlyMode = false` (relaxed runtime разрешен).
- `_catalogManualOnlyDiagnostics = false` (AI-insights могут подмешиваться в effective query по текущему runtime-поведению).
- `_catalogFilterModeActive`:
  - `false` в browse,
  - `true` только при реальном активном наборе фильтров после Apply.
- `_catalogStrictFlowActive` вычисляется по итоговому query.
- `_catalogRelaxedUnlocked` показывает, вошла ли система в relaxed-поток.
- `_catalogRelaxLevel`, `_catalogLastUsedRelaxStep`, `_catalogRelaxExhaustedLevels` — текущее состояние relax-прохода.

---

## 3. Browse vs Filter mode (as-is)

### 3.1 Browse mode

Начальное состояние:
- `_catalogFilterModeActive = false`.
- логические default-фильтры `sale/apartment` не обязаны участвовать в query.

### 3.2 Filter mode

Включается только через `Apply`, если после нормализации есть хотя бы один реальный активный фильтр.

Проверка активных фильтров:
- boolean: активен только `true`.
- array: активен при `length > 0`.
- string/number: активен при непустом/валидном значении.
- служебные ключи (`limit`, `__*`) не учитываются.

### 3.3 Зафиксированное текущее правило

- Первое пустое состояние = browse mode.
- `Reset` возвращает browse mode.
- `Apply` на пустом состоянии после reset не включает filter mode.
- Если пользователь уже в filter flow и снимает только часть фильтров, mode остается filter (пока остаются активные условия).

---

## 4. Apply / Reset / Close логика

### Apply

1. Читает payload из overlay.
2. Нормализует payload в manual overrides.
3. Вычисляет, есть ли реальные активные фильтры.
4. Ставит `_catalogFilterModeActive` по факту активности.
5. Пересчитывает подборку через `refreshCatalogByEffectiveQuery()`.

### Reset

1. Принудительно ставит `_catalogFilterModeActive = false`.
2. Очищает manual overrides.
3. Сбрасывает форму.
4. Пересчитывает подборку в browse состоянии.

### Close/Exit

Закрывает модалку без смены режима и без автоматического применения фильтров.

---

## 5. Visual defaults vs logical filters

Текущее разделение:
- `sale` в browse может быть визуально подсвечен в UI как implicit default.
- этот implicit `sale` не уходит в реальный payload, пока пользователь явно не трогал выбор сделки.
- `apartment` визуально не обязан быть выделен как default.

В filter mode:
- при отсутствии явного `operation` подставляется `sale`.
- при отсутствии явного `type` подставляется `apartment`.

Observed behavior:
- есть backward-safe ветка: если filter mode еще не активен, но в merged query уже есть критерии кроме `operation`, операция может быть выставлена в `sale`.

---

## 6. Strict flow (as-is)

1. Effective query собирается из:
   - base (в текущем runtime фактически пустой из-за manual diagnostics),
   - manual overrides.
2. `arcadia/center` принудительно фиксируют district в `primorsky`.
3. `residentialComplex` принудительно включает `rcOnly=true`.
4. Strict price window:
   - `min + max` -> как есть,
   - только `max` -> `min = round(max * 0.7)`,
   - только `min` -> верх не достраивается.
5. Запрос отправляется в backend `/api/cards/search`.
6. Результат становится strict seed и базой текущего каталога.

---

## 7. Relaxed flow (as-is runtime)

Relaxed стартует после исчерпания текущего окна strict/текущей очереди.

Candidate pool собирается из:
1. full catalog в памяти,
2. текущего `appState.allProperties`,
3. при необходимости полной подгрузки,
4. fallback через session candidates.

Dedup и исключения:
- дубли снимаются по id,
- исключаются уже показанные strict/relaxed,
- исключаются кандидаты без id.

### 7.1 Порядок relax-шагов (фактический)

`_computeRelaxStepForCandidate` сейчас использует:
1. parking soft-off
2. balcony soft-off
3. floor soft-off
4. area soft-off
5. price soft-off (только вверх, см. section 10)
6. rooms expansion/fallback
7. exact residentialComplex off (при сохранении ЖК-ограничений)
8..11 location expansion (micro layer + district matrix)
12 widest/final room fallback behavior

Hard gates в relaxed:
- operation mismatch -> reject
- type mismatch -> reject
- `rcOnly=true` + объект не ЖК -> reject
- при конкретном `residentialComplex` и отсутствии ЖК -> reject

Важно для `widest/final` слоя:
- это максимально широкий fallback только внутри execution-ограничений;
- `widest` не отменяет hard gates;
- `widest` не меняет `operation` и `type`;
- `widest` не нарушает `rcOnly`;
- `widest` не расширяет цену ниже strict lower bound;
- `widest` не пропускает цену выше relaxed ceiling, если ceiling задан.

---

## 8. Transition strict -> relaxed

Переход выполняется при достижении конца текущего окна:
- slider mode: `maybeAppendCatalogOverflow(...)`.
- list mode: `handleCatalogListNext()` при пустой очереди.

`unlockCatalogSimilarMode()`:
- подбирает следующий доступный relax step,
- добавляет порцию (до 40) в хвост,
- сохраняет history шагов,
- добавляет системное сообщение про ослабление шага.

---

## 9. Anti-cascade / guards

Есть guard против каскадного многократного unlock в один момент:
- `_catalogUnlockGuardUntil` (~320ms) в `maybeAppendCatalogOverflow`.

Эффект:
- один пользовательский шаг в конце ленты не должен вызывать серию мгновенных повторных unlock.

---

## 10. Price logic (strict + relaxed)

### 10.1 Strict price

- `min+max` -> `[min..max]`
- только `max` -> `[round(max*0.7)..max]`
- только `min` -> `[min..∞]`

### 10.2 Relaxed price

- нижняя граница не расширяется вниз:
  - если `price < strictMin` -> hard reject (`return null`).
- верхняя граница расширяется до ceiling:
  - `relaxedMax = round(maxPrice * 1.5)`.
- если `price > relaxedMax` -> hard reject.
- если `maxPrice` не задан, ceiling сверху не применяется.

Итог при заданном `maxPrice`:
- strict: `[strictMin..maxPrice]`
- relaxed: `[strictMin..relaxedMax]`

---

## 11. Smart / special flows

Smart — отдельный режим, не часть обычной комнатности.

Текущее поведение:
- пока smart-слой не исчерпан, в relaxed отбираются smart-кандидаты.
- при исчерпании smart:
  - фиксируется smart fallback,
  - query принудительно переводится в `rooms = '1'`,
  - relax levels пересобираются с начала,
  - smart затем остается мягким сигналом сортировки.

---

## 12. Focus/scroll behavior after unlock

Текущее правило:
- relaxed может добавлять карточки в хвост,
- но не должен автоматически переводить фокус на первую карточку нового слоя.

Фактическая реализация:
- при unlock сохраняется предыдущая активная карточка,
- новая порция доклеивается в поток,
- пользователь доходит до новых карточек естественно (Next/scroll).

---

## 13. Known behaviors (observed)

1. `widest` слой может выглядеть резко отличающимся на малой выборке.
2. Несколько системных сообщений подряд возможны при последовательных relax-step unlock в коротком сценарии.
3. Debug-представление показывает current window и полный порядок текущей подборки отдельно.
4. При минимальном каталоге fallback по району/комнатам может наступать быстро, без промежуточно богатых слоев.

Правило интерпретации observed:
- observed behavior фиксирует только наблюдаемый runtime-эффект;
- observed behavior сам по себе не является decision rule для изменения границ фильтрации;
- observed behavior нельзя трактовать как разрешение нарушать hard boundaries.

---

## 14. Boundaries of this canon

Документ фиксирует только то, что реально исполняется в текущем коде.

Если поведение не подтверждено явно в runtime-коде, оно должно считаться `observed behavior` и не интерпретироваться как продуктовая цель.

Для проектирования AI-слоя:
- observed effects используются как диагностический контекст;
- hard boundaries и execution rules остаются первичными и не переопределяются observed-эффектами.

---

## 15. Share controls by access role (as-is)

Share-логика разделена по уровню доступа и должна быть одинаковой во всех ключевых точках UI (`card back`, `my objects`, `wishlist`, selection overlays):

### 15.1 Admin / owner / super-admin

- показываются две share-кнопки:
  - `Share Global` (native/global share)
  - `Share Inline` (Telegram inline share)
- используются канонические SVG-ассеты:
  - `assets/link-share-btn.svg`
  - `assets/tg-share-btn.svg`
- визуально кнопки в access-overlays приведены к каноническому размеру как в карточке:
  - контейнер кнопки: `40x40`
  - иконка: `20x20`

### 15.2 Guest

- показывается одна текстовая кнопка `Поделиться`.
- действие: только inline share.
- стиль кнопки `Поделиться` в guest-режиме синхронизирован со стилем `Связаться` (отдельный класс, одинаковые визуальные параметры).

### 15.3 Behavioral boundary

- guest-flow не должен рендерить admin dual-share controls.
- admin-flow не должен деградировать до single guest share, пока роль допускает dual mode.

---

## 16. Telegram notifications topology (as-is)

Сейчас одновременно работают два слоя нотификаций:

### 16.1 Global notifier (legacy, retained)

- использует `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
- получает лиды и activity как общий централизованный канал.
- сохранён как fallback/наблюдение общей активности.

### 16.2 Project notifier (current client-scoped runtime)

- использует `TELEGRAM_INTERACTIVE_TOKEN`.
- адресаты: `OWNER_TG_ID` + `SUPER_ADMIN_ID`.
- шлёт:
  - lead notifications,
  - activity start,
  - activity final update (edit existing message by per-chat `message_id`).
- respects user alerts preferences (`leads` / `activity`) по `users.meta.telegram_alerts`.

### 16.3 Leads client scope and stats consistency

Для `POST /api/leads` фактический `client_id` нормализуется как:
- `clientId` из body, иначе
- `BOT_CLIENT_ID`, иначе
- `CLIENT_ID`, иначе
- `demo`.

Эта нормализация нужна для согласованности:
- запись лида,
- project notifier routing,
- `/stats` в текстовом боте (подсчёт лидов по клиенту).

Без корректного `client_id` статистика может показывать `0` при фактически созданных лидах.

---

Конец документа.
