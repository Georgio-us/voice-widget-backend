# Телеметрия виджета

Документация по системе логирования событий виджета.

## Обзор

Система телеметрии собирает события пользовательского взаимодействия с виджетом для аналитики и улучшения продукта. Все события сохраняются в таблице `event_logs` в Postgres.

## Согласие пользователя (Consent)

Телеметрия отправляется только если пользователь дал согласие на аналитику (`analytics: true`). Исключение: событие `consent_update` отправляется всегда для отслеживания изменений согласия.

**Логика на фронтенде:**
- При первом открытии виджета показывается баннер согласия
- Пользователь может выбрать: "Accept all", "Reject all" или настроить категории вручную
- Состояние согласия сохраняется в `localStorage` (`vw_cookie_consent`) и cookie (`vw_consent`)
- Модуль `telemetryClient.js` проверяет `analytics` флаг перед отправкой событий

**Логика на бэкенде:**
- Бэкенд принимает все события без проверки согласия
- Считается, что если событие пришло с фронтенда, пользователь дал согласие
- События `user_message` и `assistant_reply` логируются на бэкенде автоматически

## Типы событий (EventTypes)

### Сессии

#### `session_start`
Первый вход пользователя в виджет за сессию.

**Payload:**
```json
{
  "url": "string",           // текущий URL страницы
  "referrer": "string",      // referrer или null
  "lang": "string",          // язык UI / язык браузера
  "widgetVersion": "string", // версия виджета (если есть)
  "consent": {               // снимок флагов согласия
    "analytics": true/false,
    "performance": true/false,
    "marketing": true/false
  }
}
```

#### `session_end`
Завершение сессии (по явному действию или по таймауту).

**Payload:**
```json
{
  "reason": "timeout" | "user_close" | "page_unload",
  "durationMs": number,      // длительность сессии в мс (если можем посчитать)
  "messagesCount": number,   // сколько сообщений в диалоге
  "cardsShown": number      // сколько карточек было показано за сессию
}
```

### Виджет

#### `widget_open`
Открытие виджета.

**Payload:** нет (или минимальный)

#### `widget_close`
Закрытие виджета.

**Payload:** нет (или минимальный)

#### `widget_minimize`
Сворачивание виджета (если реализовано).

**Payload:** нет

#### `widget_restore`
Восстановление виджета (если реализовано).

**Payload:** нет

### Диалог

#### `user_message`
Пользователь отправил текст или голос.

**Payload:**
```json
{
  "inputType": "text" | "audio",
  "text": "string",          // полный текст (с учётом согласия)
  "textLength": number,      // длина текста
  "audioDurationMs": number, // длительность аудио в мс (если есть)
  "stage": "string",         // qualification / search / closing
  "clientProfile": {         // ключевые поля профиля
    "language": "string",
    "location": "string",
    "budgetMin": number,
    "budgetMax": number,
    "purpose": "string",
    "propertyType": "string",
    "urgency": "string"
  },
  "insights": {              // структурированные инсайты
    "name": "string",
    "operation": "string",
    "budget": number,
    "type": "string",
    "location": "string",
    "rooms": number,
    "area": number,
    "details": "string",
    "preferences": "string",
    "progress": number
  },
  "cardsCount": number      // сколько карточек уже показано в этой сессии
}
```

#### `assistant_reply`
Ответ ассистента.

**Payload:**
```json
{
  "messageId": "string",     // уникальный ID сообщения
  "messageText": "string",   // короткий отрывок (первые 200 символов) или полный текст
  "hasCards": boolean,       // есть ли карточки в ответе
  "cards": [                 // массив показанных объектов
    {
      "id": "string",
      "city": "string",
      "district": "string",
      "priceEUR": number,
      "rooms": number
    }
  ],
  "inputType": "text" | "audio",
  "tokens": {
    "prompt": number,
    "completion": number,
    "total": number
  },
  "timing": {
    "transcription": number,  // время транскрипции в мс
    "gpt": number,            // время обработки GPT в мс
    "total": number           // общее время в мс
  },
  "stage": "string",          // текущая стадия диалога
  "insights": {               // структурированные инсайты
    // ... (та же структура, что в user_message)
  }
}
```

### Карточки

#### `card_show`
Показ карточки объекта.

**Payload:**
```json
{
  "propertyId": "string",    // ID объекта
  "index": number,           // позиция карточки в текущем слайдере
  "totalInSlider": number,   // всего карточек в слайдере
  "source": "recommendation" | "manual_search" | "followup",
  "filters": {               // фильтры (если есть на фронте)
    "minPrice": number,
    "maxPrice": number,
    "rooms": number,
    "city": "string",
    "district": "string"
  }
}
```

#### `card_next`
Пользователь запросил «ещё вариант».

**Payload:**
```json
{
  "propertyId": "string",    // ID текущей карточки
  "index": number,           // позиция в слайдере
  "totalInSlider": number,   // всего карточек в слайдере
  "source": "recommendation" | "manual_search" | "followup"
}
```

#### `card_like`
Пользователь лайкнул карточку.

**Payload:**
```json
{
  "propertyId": "string",
  "index": number,
  "totalInSlider": number
}
```

#### `card_dislike`
Пользователь дизлайкнул карточку (если реализовано).

**Payload:** аналогично `card_like`

### Лид-форма

#### `lead_form_open`
Открытие формы заявки.

**Payload:**
```json
{
  "source": "widget_cta" | "card_cta" | "support_tab",
  "prefill": boolean         // есть ли предзаполнение e-mail/WhatsApp из диалога
}
```

#### `lead_form_submit`
Отправка формы заявки.

**Payload:**
```json
{
  "source": "widget_cta" | "card_cta" | "support_tab",
  "fields": {                // какие поля заполнены
    "email": boolean,
    "phone": boolean,
    "whatsapp": boolean,
    "messageLength": number  // длина сообщения
  },
  "success": boolean,        // успешна ли отправка
  "errorCode": "string"      // код ошибки (если не success)
}
```

#### `lead_form_error`
Ошибка при отправке формы.

**Payload:**
```json
{
  "source": "string",
  "errorCode": "string",
  "message": "string"
}
```

### Согласие

#### `consent_update`
Изменение согласия на cookies/analytics.

**Payload:**
```json
{
  "analytics": boolean,
  "performance": boolean,
  "marketing": boolean,
  "timestampLocal": "string" // локальное время браузера (ISO)
}
```

**Примечание:** Это событие отправляется всегда, даже если `analytics: false`.

### Ошибки

#### `error`
Системные ошибки.

**Payload:**
```json
{
  "scope": "backend" | "frontend" | "network",
  "message": "string",       // сообщение об ошибке
  "stack": "string",         // stack trace (обрезано до 500 символов)
  "meta": {                  // дополнительная информация
    "statusCode": number,
    "path": "string",
    "method": "string",
    "eventType": "string"    // в каком событии упало
  }
}
```

## Структура таблицы event_logs

```sql
CREATE TABLE event_logs (
  id          SERIAL PRIMARY KEY,
  created_at  TIMESTAMP DEFAULT NOW(),
  session_id  TEXT,
  event_type  TEXT NOT NULL,
  user_ip     TEXT,
  user_agent  TEXT,
  country     TEXT,          -- пока всегда NULL
  city        TEXT,          -- пока всегда NULL
  payload     JSONB
);
```

## API

### POST /api/telemetry/log

Принимает события телеметрии от фронтенда.

**Request Body:**
```json
{
  "eventType": "string",          // ОБЯЗАТЕЛЬНО
  "sessionId": "string | null",   // опционально
  "userId": "string | null",     // опционально
  "source": "string | null",     // например: "widget", "backend"
  "url": "string | null",        // текущий URL страницы
  "payload": { ... }             // произвольный JSON с деталями события
}
```

**Response:**
```json
{
  "ok": true
}
```

или

```json
{
  "ok": false,
  "error": "eventType is required"
}
```

## Утилиты

### `buildPayload(base, extra)`

Функция для построения payload: фильтрует `undefined`/`null`, но сохраняет `0`, `false`, `''`, `[]`.

**Использование:**
```javascript
import { buildPayload } from './services/eventLogger.js';

const payload = buildPayload(
  { field1: 'value1', field2: null },
  { field3: 0, field4: false }
);
// Результат: { field1: 'value1', field3: 0, field4: false }
// field2 удалён (null), field3 и field4 сохранены
```

## Интеграция

### Фронтенд

1. Импортировать `telemetryClient`:
```javascript
import { initTelemetry, setConsent, log, EventTypes } from './modules/telemetryClient.js';
```

2. Инициализировать при создании виджета:
```javascript
initTelemetry({ baseUrl, sessionId, userId });
```

3. Установить согласие из localStorage:
```javascript
const consent = getConsent();
if (consent && consent.selections) {
  setConsent({ analytics: consent.selections.analytics === true });
}
```

4. Логировать события:
```javascript
log(EventTypes.WIDGET_OPEN);
log(EventTypes.USER_MESSAGE, { inputType: 'text', text: '...' });
```

### Бэкенд

1. Импортировать `logEvent` и `EventTypes`:
```javascript
import { logEvent, EventTypes, buildPayload } from '../services/eventLogger.js';
```

2. Логировать события:
```javascript
logEvent({
  sessionId,
  eventType: EventTypes.USER_MESSAGE,
  userIp: req.ip,
  userAgent: req.headers['user-agent'],
  source: 'backend',
  payload: buildPayload({ inputType: 'text', text: '...' })
});
```

## Примечания

- Все события логируются асинхронно и не блокируют основной поток
- Ошибки логирования не должны влиять на работу виджета
- Payload должен быть валидным JSON объектом (не массив, не примитив)
- Если payload не объект, он будет обёрнут в `{ value: payload }`
- Stack trace в ошибках обрезается до 500 символов для экономии места
