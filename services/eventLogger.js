// services/eventLogger.js
import { pool } from './db.js';

/**
 * Универсальный логгер событий виджета.
 * Пишет одну строку в таблицу event_logs.
 *
 * Поля в таблице:
 * - id          (serial, PK)
 * - created_at  (date / timestamp with default now())
 * - session_id  (text)
 * - event_type  (text)
 * - user_ip     (text)
 * - user_agent  (text)
 * - country     (text, nullable - не используется на этом этапе)
 * - city        (text, nullable - не используется на этом этапе)
 * - payload     (json)
 */

/**
 * Словарь типов событий для телеметрии
 * Используется для минимизации опечаток и стандартизации
 */
export const EventTypes = {
  // Сессии
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  
  // Виджет
  WIDGET_OPEN: 'widget_open',
  WIDGET_CLOSE: 'widget_close',
  WIDGET_MINIMIZE: 'widget_minimize',
  WIDGET_RESTORE: 'widget_restore',
  
  // Диалог
  USER_MESSAGE: 'user_message',
  ASSISTANT_REPLY: 'assistant_reply',
  
  // Карточки
  CARD_SHOW: 'card_show',
  CARD_NEXT: 'card_next',
  CARD_LIKE: 'card_like',
  CARD_DISLIKE: 'card_dislike',
  
  // Лид-форма
  LEAD_FORM_OPEN: 'lead_form_open',
  LEAD_FORM_SUBMIT: 'lead_form_submit',
  LEAD_FORM_ERROR: 'lead_form_error',
  
  // Согласие
  CONSENT_UPDATE: 'consent_update',
  
  // Ошибки
  ERROR: 'error'
};

/**
 * Утилита для построения payload: фильтрует undefined/null, но сохраняет 0 и false
 * @param {Object} base - базовый объект
 * @param {Object} extra - дополнительные поля
 * @returns {Object} - очищенный объект без undefined/null
 */
export function buildPayload(base = {}, extra = {}) {
  const merged = { ...base, ...extra };
  const cleaned = {};
  for (const [key, value] of Object.entries(merged)) {
    // Пропускаем только undefined и null, но сохраняем 0, false, '', []
    if (value !== undefined && value !== null) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Валидация и нормализация payload: должен быть объектом или null/undefined
 * @param {any} payload - исходный payload
 * @returns {Object|null} - нормализованный payload
 */
function normalizePayload(payload) {
  if (payload === null || payload === undefined) {
    return null;
  }
  
  // Если payload - валидный объект (не массив, не Date, не другой класс)
  if (typeof payload === 'object' && !Array.isArray(payload) && payload.constructor === Object) {
    return payload;
  }
  
  // Если payload - не объект (строка, массив, число, boolean и т.д.)
  // Оборачиваем в объект с ключом 'value' для сохранения данных
  return { value: payload };
}

export async function logEvent({
  sessionId,
  eventType,
  userIp,
  userAgent,
  userId = null,
  source = null,
  url = null,
  payload = null
}) {
  // Валидация и нормализация payload
  const normalizedPayload = normalizePayload(payload);
  
  try {
    await pool.query(
      `
      INSERT INTO event_logs (
        session_id,
        event_type,
        user_ip,
        user_agent,
        country,
        city,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        sessionId || null,
        eventType,
        userIp || null,
        userAgent || null,
        null, // country - не используется на этом этапе
        null, // city - не используется на этом этапе
        JSON.stringify(
          buildPayload(
            normalizedPayload || {},
            {
              ...(userId ? { userId } : {}),
              ...(source ? { source } : {}),
              ...(url ? { url } : {})
            }
          )
        )
      ]
    );
  } catch (err) {
    console.error('❌ Failed to log event', { eventType, sessionId, err });
    // Пробрасываем ошибку дальше, чтобы вызывающий код мог её обработать
    throw err;
  }
}