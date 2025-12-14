// services/supportRepository.js
// Репозиторий для работы с тикетами поддержки (таблица support_requests)
import { pool } from './db.js';

const DEFAULT_CLIENT_ID = 'demo';

/**
 * Создаёт новый тикет поддержки в таблице support_requests.
 * 
 * Валидация на уровне сервиса:
 * - message обязателен (не пустая строка после trim)
 * - problemType обязателен (строка)
 * - clientId по умолчанию 'demo', если не передан или пустой
 * - sessionId, language, extra могут быть null
 * - Пустые строки превращаются в null
 * 
 * @param {Object} params
 * @param {string|null} params.sessionId - идентификатор сессии
 * @param {string} [params.clientId='demo'] - идентификатор клиента
 * @param {string} params.problemType - тип проблемы (обязателен)
 * @param {string} params.message - сообщение/описание проблемы (обязателен)
 * @param {string|null} params.language - язык интерфейса (ru, en, es...)
 * @param {Object|null} params.extra - дополнительные данные в формате JSON (опционально)
 * @returns {Promise<{id: number, createdAt: Date}>} - созданный тикет с id и createdAt
 * @throws {Error} - если валидация не прошла или произошла ошибка БД
 */
export async function createSupportRequest({
  sessionId,
  clientId = DEFAULT_CLIENT_ID,
  problemType,
  message,
  language,
  extra
}) {
  // Валидация: message обязателен и не пустой после trim
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('message is required and must be a non-empty string');
  }

  // Валидация: problemType обязателен
  if (!problemType || typeof problemType !== 'string' || problemType.trim().length === 0) {
    throw new Error('problemType is required and must be a non-empty string');
  }

  // Нормализация clientId: если не передан или пустой, используем DEFAULT_CLIENT_ID
  const normalizedClientId = (clientId && String(clientId).trim().length > 0)
    ? String(clientId).trim()
    : DEFAULT_CLIENT_ID;

  // Нормализация значений для БД (null вместо пустых строк)
  const normalizedSessionId = sessionId && String(sessionId).trim().length > 0
    ? String(sessionId).trim()
    : null;
  const normalizedLanguage = language && String(language).trim().length > 0
    ? String(language).trim()
    : null;
  const normalizedExtra = extra && typeof extra === 'object' ? JSON.stringify(extra) : null;

  try {
    const result = await pool.query(
      `
      INSERT INTO support_requests (
        session_id,
        client_id,
        problem_type,
        message,
        language,
        extra
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at
      `,
      [
        normalizedSessionId,
        normalizedClientId,
        problemType.trim(),
        message.trim(),
        normalizedLanguage,
        normalizedExtra
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      throw new Error('Failed to create support request: no rows returned');
    }

    return {
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at
    };
  } catch (err) {
    // Если это ошибка валидации, пробрасываем её дальше
    if (err.message && (
      err.message.includes('is required') ||
      err.message.includes('must be')
    )) {
      throw err;
    }

    // Для ошибок БД логируем и пробрасываем с понятным сообщением
    console.error('❌ Database error in createSupportRequest:', err);
    throw new Error(`Database error: ${err.message}`);
  }
}

