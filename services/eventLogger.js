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
        JSON.stringify({
          ...(payload || {}),
          ...(userId ? { userId } : {}),
          ...(source ? { source } : {}),
          ...(url ? { url } : {})
        })
      ]
    );
  } catch (err) {
    console.error('❌ Failed to log event', { eventType, sessionId, err });
  }
}