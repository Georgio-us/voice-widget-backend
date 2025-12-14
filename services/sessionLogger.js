// services/sessionLogger.js
// Session-level logging: логирование целого диалога по одной строке на сессию в таблицу session_logs
import { pool } from './db.js';

/**
 * Создаёт или обновляет запись сессии в таблице session_logs.
 * При первом создании заполняет user_agent и user_ip.
 * При обновлении аккуратно сливает новый payloadPatch с существующим payload.
 * 
 * @param {Object} params
 * @param {string} params.sessionId - уникальный идентификатор сессии
 * @param {string|null} params.userAgent - User-Agent из заголовков запроса (только при первом создании)
 * @param {string|null} params.userIp - IP адрес пользователя (только при первом создании)
 * @param {Object} params.payloadPatch - объект для слияния с существующим payload
 * @returns {Promise<void>}
 */
export async function upsertSessionLog({ sessionId, userAgent = null, userIp = null, payloadPatch = {} }) {
  if (!sessionId) {
    console.warn('⚠️ upsertSessionLog: sessionId не передан');
    return;
  }

  try {
    // Проверяем, существует ли уже запись для этой сессии
    const existingResult = await pool.query(
      'SELECT payload FROM session_logs WHERE session_id = $1',
      [sessionId]
    );

    let finalPayload;

    if (existingResult.rows.length === 0) {
      // Первое создание записи: инициализируем базовую структуру payload
      finalPayload = {
        sessionMeta: {
          startedAt: new Date().toISOString(),
          endedAt: null,
          totalMessages: 0,
          totalUserMessages: 0,
          totalAssistantMessages: 0
        },
        messages: []
      };

      // Сливаем payloadPatch поверх базовой структуры
      finalPayload = deepMerge(finalPayload, payloadPatch);

      // INSERT: создаём новую запись с user_agent и user_ip
      await pool.query(
        `
        INSERT INTO session_logs (session_id, user_agent, user_ip, payload)
        VALUES ($1, $2, $3, $4)
        `,
        [
          sessionId,
          userAgent || null,
          userIp || null,
          JSON.stringify(finalPayload)
        ]
      );
    } else {
      // UPDATE: обновляем существующую запись
      const existingPayload = existingResult.rows[0].payload || {};
      
      // Сливаем существующий payload с новым payloadPatch
      finalPayload = deepMerge(existingPayload, payloadPatch);

      // Обновляем только payload, user_agent и user_ip не трогаем
      await pool.query(
        `
        UPDATE session_logs
        SET payload = $1
        WHERE session_id = $2
        `,
        [JSON.stringify(finalPayload), sessionId]
      );
    }
  } catch (err) {
    console.error('❌ Failed to upsert session log', { sessionId, err: err.message });
    // Не пробрасываем ошибку, чтобы не ломать основной поток
  }
}

/**
 * Добавляет новое сообщение в массив messages сессии.
 * Обёртка над upsertSessionLog, которая читает текущий payload,
 * добавляет сообщение в массив и обновляет счётчики.
 * 
 * @param {Object} params
 * @param {string} params.sessionId - уникальный идентификатор сессии
 * @param {string} params.role - роль отправителя: 'user' | 'assistant' | 'system'
 * @param {Object} params.message - объект сообщения с полями:
 *   - inputType?: 'text' | 'audio'
 *   - text?: string - текст сообщения
 *   - transcription?: string - транскрипция (если было аудио)
 *   - cards?: Array - массив карточек
 *   - tokens?: { prompt, completion, total }
 *   - timing?: { transcription, gpt, total }
 *   - meta?: Object - дополнительные метаданные (stage, insights и т.д.)
 * @param {string|null} params.userAgent - User-Agent (только при первом создании)
 * @param {string|null} params.userIp - IP адрес (только при первом создании)
 * @returns {Promise<void>}
 */
export async function appendMessage({ sessionId, role, message, userAgent = null, userIp = null }) {
  if (!sessionId || !role) {
    console.warn('⚠️ appendMessage: sessionId или role не передан');
    return;
  }

  // Получаем текущий payload для чтения структуры
  let currentPayload;
  try {
    const result = await pool.query(
      'SELECT payload FROM session_logs WHERE session_id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      // Создаём базовую структуру, если записи ещё нет
      currentPayload = {
        sessionMeta: {
          startedAt: new Date().toISOString(),
          endedAt: null,
          totalMessages: 0,
          totalUserMessages: 0,
          totalAssistantMessages: 0
        },
        messages: []
      };
    } else {
      currentPayload = result.rows[0].payload || {};
      
      // Гарантируем наличие базовой структуры
      if (!currentPayload.sessionMeta) {
        currentPayload.sessionMeta = {
          startedAt: new Date().toISOString(),
          endedAt: null,
          totalMessages: 0,
          totalUserMessages: 0,
          totalAssistantMessages: 0
        };
      }
      if (!Array.isArray(currentPayload.messages)) {
        currentPayload.messages = [];
      }
    }
  } catch (err) {
    console.error('❌ Failed to read session payload for appendMessage', { sessionId, err: err.message });
    // Создаём базовую структуру при ошибке чтения
    currentPayload = {
      sessionMeta: {
        startedAt: new Date().toISOString(),
        endedAt: null,
        totalMessages: 0,
        totalUserMessages: 0,
        totalAssistantMessages: 0
      },
      messages: []
    };
  }

  // Формируем объект нового сообщения
  const newMessage = {
    ts: new Date().toISOString(),
    role: role,
    ...(message.inputType ? { inputType: message.inputType } : {}),
    ...(message.text ? { text: message.text } : {}),
    ...(message.transcription ? { transcription: message.transcription } : {}),
    ...(message.cards && Array.isArray(message.cards) && message.cards.length > 0
      ? { cards: message.cards.map(card => ({
          id: card.id || null,
          city: card.city || null,
          district: card.district || null,
          priceEUR: card.priceEUR || null,
          rooms: card.rooms || null
        })) }
      : {}),
    ...(message.tokens ? { tokens: message.tokens } : {}),
    ...(message.timing ? { timing: message.timing } : {}),
    ...(message.meta ? { meta: message.meta } : {})
  };

  // Добавляем сообщение в массив
  currentPayload.messages.push(newMessage);

  // Обновляем счётчики
  currentPayload.sessionMeta.totalMessages = currentPayload.messages.length;
  currentPayload.sessionMeta.totalUserMessages = currentPayload.messages.filter(m => m.role === 'user').length;
  currentPayload.sessionMeta.totalAssistantMessages = currentPayload.messages.filter(m => m.role === 'assistant').length;

  // Вызываем upsertSessionLog для сохранения
  await upsertSessionLog({
    sessionId,
    userAgent,
    userIp,
    payloadPatch: currentPayload
  });
}

/**
 * Обновляет метаданные сессии (например, при завершении сессии).
 * 
 * @param {Object} params
 * @param {string} params.sessionId - уникальный идентификатор сессии
 * @param {Object} params.sessionMetaUpdate - объект с полями для обновления sessionMeta:
 *   - endedAt?: string - ISO-строка времени завершения
 *   - и другие поля по необходимости
 * @returns {Promise<void>}
 */
export async function updateSessionMeta({ sessionId, sessionMetaUpdate = {} }) {
  if (!sessionId) {
    console.warn('⚠️ updateSessionMeta: sessionId не передан');
    return;
  }

  try {
    const result = await pool.query(
      'SELECT payload FROM session_logs WHERE session_id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      // Если записи нет, создаём базовую структуру
      const newPayload = {
        sessionMeta: {
          startedAt: new Date().toISOString(),
          endedAt: null,
          totalMessages: 0,
          totalUserMessages: 0,
          totalAssistantMessages: 0,
          ...sessionMetaUpdate
        },
        messages: []
      };

      await pool.query(
        'INSERT INTO session_logs (session_id, payload) VALUES ($1, $2)',
        [sessionId, JSON.stringify(newPayload)]
      );
    } else {
      // Обновляем существующий payload
      const currentPayload = result.rows[0].payload || {};
      
      if (!currentPayload.sessionMeta) {
        currentPayload.sessionMeta = {
          startedAt: new Date().toISOString(),
          endedAt: null,
          totalMessages: 0,
          totalUserMessages: 0,
          totalAssistantMessages: 0
        };
      }

      // Сливаем обновления
      currentPayload.sessionMeta = {
        ...currentPayload.sessionMeta,
        ...sessionMetaUpdate
      };

      await pool.query(
        'UPDATE session_logs SET payload = $1 WHERE session_id = $2',
        [JSON.stringify(currentPayload), sessionId]
      );
    }
  } catch (err) {
    console.error('❌ Failed to update session meta', { sessionId, err: err.message });
  }
}

/**
 * Глубокая слияние объектов (deep merge).
 * Используется для аккуратного слияния payload при обновлении.
 * 
 * @param {Object} target - целевой объект
 * @param {Object} source - исходный объект для слияния
 * @returns {Object} - результат слияния
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      // Если оба значения - объекты (не массивы, не null), делаем рекурсивное слияние
      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue);
      } else {
        // Иначе просто заменяем значением из source
        result[key] = sourceValue;
      }
    }
  }

  return result;
}

