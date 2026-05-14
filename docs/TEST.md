# Тест

Дата: 2026-05-14  
Цель: безопасный smoke-набор перед клиентскими тестами (без провокации известных edge-case формулировок).

## Как запускать

1. Для каждого теста используй отдельную новую сессию.
2. После каждого запроса проверяй:
- ответ ассистента,
- debug (`operation/type/location/budget`),
- системную кнопку подборки,
- фактические карточки.
3. Для тестов с заявкой:
- отправка только из карточки объекта (`Связаться` на 3-й стороне),
- проверка в CRM: `Property`, `Name`, `Language`, `REF ОБЪЕКТА`.

## RU (5)

### RU-1 Sale apartment
Запрос: `Ищу квартиру в покупку в Аликанте, бюджет до 250к.`  
Ожидаемо:
- `operation=покупка/sale`
- `type=квартира/apartment`
- `location=Аликанте`
- подборка есть, кнопка `Смотреть подборку` есть.

### RU-2 Rent apartment
Запрос: `Ищу квартиру в аренду в Торревьехе, бюджет до 1200 евро в месяц.`  
Ожидаемо:
- `operation=аренда/rent`
- `type=квартира/apartment`
- `location=Торревьеха`
- подборка по аренде (не fallback в продажу).

### RU-3 Type switch to villa
Шаг 1: `Ищу квартиру в покупке в Аликанте до 300к.`  
Шаг 2: `Покажи теперь виллы до 500к.`  
Ожидаемо:
- после шага 2 `type=вилла/villa`
- бюджет переписан на новый,
- подборка обновилась под новый тип.

### RU-4 Unsupported geo
Запрос: `Покажите объекты в Барселоне.`  
Ожидаемо:
- ассистент не обещает подборку по Барселоне,
- объясняет доступные направления,
- появляется кнопка `Смотреть подборку`,
- карточки не должны быть представлены как “Барселона”.

### RU-4b Unsupported after supported context
Шаг 1: `Ищу квартиру в Мурсии в покупку.`
Шаг 2: `А в Жироне есть?`
Ожидаемо:
- шаг 1 даёт подборку по supported geo,
- шаг 2 не делает молчаливый fallback обратно в каталог,
- появляется кнопка `Связаться с менеджером`.

### RU-4c Broad geo
Запрос: `Хочу купить квартиру в Испании.`
Ожидаемо:
- `geo.status=broad`,
- локация Испания не используется как фильтр,
- появляется кнопка `Смотреть подборку`.

### RU-5 Lead from card
Шаг 1: `Ищу квартиру в Аликанте в покупку.`  
Шаг 2: открыть карточку -> 3-я сторона -> `Связаться` -> отправить заявку.  
Ожидаемо:
- лид приходит в CRM,
- `Property` заполнен (не пусто),
- `REF ОБЪЕКТА` в тексте заполнен,
- `Language = ru`.

## EN (5)

### EN-1 Sale apartment
Prompt: `I want to buy an apartment in Alicante, budget up to 250k.`  
Expected:
- `operation=sale`
- `type=apartment`
- `location=Alicante`
- selection updated + show button.

### EN-2 Rent apartment
Prompt: `I need an apartment for rent in Torrevieja, up to 1200 EUR per month.`  
Expected:
- `operation=rent`
- `type=apartment`
- `location=Torrevieja`
- no accidental switch to sale.

### EN-3 Add preference
Step 1: `I am looking to buy an apartment in Alicante.`  
Step 2: `Add terrace and near the sea.`  
Expected:
- existing fields preserved,
- new preference fields added,
- selection refreshes.

### EN-4 Unsupported geo
Prompt: `Show me properties in Madrid.`  
Expected:
- assistant does not claim active Madrid inventory,
- explains supported areas,
- shows `Open selection`,
- cards are not presented as Madrid inventory.

### EN-4b Unsupported after supported context
Step 1: `I want to buy an apartment in Murcia.`
Step 2: `What about Girona?`
Expected:
- step 1 returns supported selection,
- step 2 renders `Contact manager`, not silent broad fallback.

### EN-5 Lead from card
Step 1: `I want to buy an apartment in Alicante.`  
Step 2: open card -> `Contact` form -> submit lead.  
Expected:
- CRM lead received,
- `Property` set,
- `Language = en`.

## ES (5)

### ES-1 Compra piso
Prompt: `Quiero comprar un piso en Alicante, presupuesto hasta 250k.`  
Expected:
- `operation=sale`
- `type=apartment/piso`
- `location=Alicante`
- selección actualizada.

### ES-2 Alquiler piso
Prompt: `Busco piso en alquiler en Torrevieja, hasta 1200 EUR al mes.`  
Expected:
- `operation=rent`
- `type=apartment/piso`
- `location=Torrevieja`
- no fallback accidental a venta.

### ES-3 Cambio de tipo
Paso 1: `Busco piso en compra en Alicante.`  
Paso 2: `Ahora enséñame villas hasta 500k.`  
Expected:
- `type=villa` tras paso 2,
- query actualizada con nuevo tipo/presupuesto.

### ES-4 Zona no soportada
Prompt: `Muéstrame propiedades en Barcelona.`  
Expected:
- no prometer inventario activo en Barcelona,
- explicar zonas soportadas,
- mostrar `Ver selección`,
- las tarjetas no deben presentarse como inventario de Barcelona.

### ES-4b Zona no soportada después de zona soportada
Paso 1: `Quiero comprar piso en Murcia.`
Paso 2: `¿Y en Girona?`
Expected:
- paso 1 devuelve selección soportada,
- paso 2 muestra `Contactar con gerente`, no fallback amplio silencioso.

### ES-5 Lead from card
Paso 1: `Quiero comprar piso en Alicante.`  
Paso 2: abrir tarjeta -> `Contactar` -> enviar lead.  
Expected:
- lead en CRM,
- `Property` con REF,
- `Language = es`.

## Чек-лист фиксации результата

Для каждого теста зафиксировать:
- `PASS/FAIL`
- краткий факт (1 строка)
- debug ключи: `operation`, `type`, `location`, `matchedCount`
- для geo-тестов: `geo.status`, `droppedFields.reason`, `ui.systemEvent.action`
- для lead-тестов: `leadId`, `Property`, `Language`, `REF ОБЪЕКТА`.
