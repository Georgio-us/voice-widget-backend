# QA AI/Filters Report — 2026-04-22

Документ фиксирует фактические результаты ручных тестов и debug-разборов за текущую сессию.  
Это рабочий отчёт-старт для следующего дня, не to-be дизайн.

---

## 1) Что проверяли

- AI -> canonical patch -> effective query.
- Поведение strict/relaxed при жёстких комбинациях фильтров.
- Разницу между manual и AI-driven фильтрацией.
- Диагностическую полноту debug menu.

---

## 2) Подтверждённые результаты

1. Канонизация operation в AI path работает:
   - `source.operation=buy` корректно становится `operation=sale` в canonical patch и final query.

2. Приоритет `manual > AI` подтверждён:
   - после ручного изменения чекбоксов/параметров effective query следует manual состоянию.

3. Debug menu расширен и полезен для трассировки:
   - видна цепочка `source -> canonicalPatch -> preValidation -> postValidation`;
   - видны runtime guards;
   - виден dual match breakdown: `manual` и `effective`.

4. Валидация RC не пропускает невалидный specific RC в final query:
   - при мусорном/неподтверждённом названии сохраняется fallback-смысл (`rcOnly`), но не коммитится неверное имя ЖК.

---

## 3) Наблюдения по кейсам

### Кейс A: AI rent + districts + rcOnly + balcony
- По AI strict выдача формируется.
- `Match 0/0` в старом debug объясняется тем, что блок матча считался только от manual filters.
- В новой версии debug это закрыто (manual/effective считаются отдельно).

### Кейс B: AI sale + arcadia + parking + balcony + rooms + price
- При `arcadia=true` и жёсткой связке условий strict мог давать `count=0`.
- После ручного отключения `arcadia` strict выдача появилась, relaxed корректно расширил набор.
- Это указывает на «узкий фильтр», а не на обрыв AI->execution маршрута.

### Кейс C: Комбинации rooms в rent-сценариях
- На `rooms=[2,3]` при текущем срезе каталога наблюдался `count=0`.
- На `rooms=[1,2]` / `rooms=[1,3]` выборка появлялась.
- Вывод: часть «пустых» кейсов обусловлена составом данных при строгих условиях.

---

## 4) Где остаются открытые вопросы

1. Location/district/microdistrict интерпретация:
- когда и почему AI-сигналы приводят к сужению до одного района.

2. Согласованность метрик:
- `payload totalMatches/strictMatches/relaxedMatches` не всегда совпадает с фактическим `selection_applied count`.
- Нужна чёткая трактовка этих метрик в документации/debug.

3. Extraction quality (не архитектура):
- кейсы со сложными локационными формулировками;
- дальнейшая калибровка извлечения без расширения scope.

---

## 5) Что не делали сознательно

- Не меняли strict/relaxed алгоритм ранжирования.
- Не вводили новую confirm/override политику.
- Не расширяли multi-value residentialComplex.
- Не делали архитектурный рефактор вне точечных фиксов debug/канонизации.

---

## 6) Стартовая точка на завтра

1. Матрица кейсов по location/district/arcadia (AI-only и manual override).
2. Разбор сужения выборки (ожидаемое vs нежелательное).
3. Фиксация интерпретации `meta matches` vs `selection_applied count` в каноне/debug.
