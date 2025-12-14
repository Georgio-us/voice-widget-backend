// services/leadsRepository.js
// Репозиторий для работы с лидами (таблица lead_requests)
import { pool } from './db.js';

const DEFAULT_CLIENT_ID = 'demo';

/**
 * Создаёт новый лид в таблице lead_requests.
 * 
 * Валидация на уровне сервиса:
 * - name обязателен (не пустая строка)
 * - consent должен быть true (иначе лид не создаётся)
 * - хотя бы один из phoneNumber или email должен быть не пустым
 * - source обязателен (строка)
 * 
 * @param {Object} params
 * @param {string} params.sessionId - идентификатор сессии
 * @param {string} [params.clientId='demo'] - идентификатор клиента
 * @param {string} params.source - источник лида (widget_full_form, widget_short_form и т.п.)
 * @param {string} params.name - имя клиента (обязательно)
 * @param {string|null} params.phoneCountryCode - код страны телефона (например +34)
 * @param {string|null} params.phoneNumber - номер телефона
 * @param {string|null} params.email - email адрес
 * @param {string|null} params.preferredContactMethod - предпочитаемый способ связи (whatsapp, phone, email)
 * @param {string|null} params.comment - комментарий (может быть null)
 * @param {string} params.language - язык диалога/интерфейса (ru, en, es...)
 * @param {string|null} params.propertyId - ID объекта недвижимости (опционально)
 * @param {boolean} params.consent - согласие на обработку данных (должно быть true)
 * @param {Object|null} params.extra - дополнительные данные в формате JSON (опционально)
 * @returns {Promise<{id: number, created_at: Date}>} - созданный лид с id и created_at
 * @throws {Error} - если валидация не прошла или произошла ошибка БД
 */
export async function createLead({
  sessionId,
  clientId = DEFAULT_CLIENT_ID,
  source,
  name,
  phoneCountryCode = null,
  phoneNumber = null,
  email = null,
  preferredContactMethod = null,
  comment = null,
  language,
  propertyId = null,
  consent,
  extra = null
}) {
  // Валидация: name обязателен
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('name is required and must be a non-empty string');
  }

  // Валидация: consent должен быть true
  if (consent !== true) {
    throw new Error('consent must be true to create a lead');
  }

  // Валидация: хотя бы один из phoneNumber или email должен быть заполнен
  const phoneNumberTrimmed = phoneNumber ? String(phoneNumber).trim() : '';
  const emailTrimmed = email ? String(email).trim() : '';
  if (phoneNumberTrimmed.length === 0 && emailTrimmed.length === 0) {
    throw new Error('at least one of phoneNumber or email must be provided');
  }

  // Валидация: source обязателен
  if (!source || typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('source is required and must be a non-empty string');
  }

  // Нормализация значений для БД (null вместо пустых строк)
  const normalizedPhoneCountryCode = phoneCountryCode && String(phoneCountryCode).trim().length > 0
    ? String(phoneCountryCode).trim()
    : null;
  const normalizedPhoneNumber = phoneNumberTrimmed.length > 0 ? phoneNumberTrimmed : null;
  const normalizedEmail = emailTrimmed.length > 0 ? emailTrimmed : null;
  const normalizedPreferredContactMethod = preferredContactMethod && String(preferredContactMethod).trim().length > 0
    ? String(preferredContactMethod).trim()
    : null;
  const normalizedComment = comment && String(comment).trim().length > 0
    ? String(comment).trim()
    : null;
  const normalizedPropertyId = propertyId && String(propertyId).trim().length > 0
    ? String(propertyId).trim()
    : null;
  const normalizedExtra = extra && typeof extra === 'object' ? JSON.stringify(extra) : null;

  try {
    const result = await pool.query(
      `
      INSERT INTO lead_requests (
        session_id,
        client_id,
        source,
        name,
        phone_country_code,
        phone_number,
        email,
        preferred_contact_method,
        comment,
        language,
        property_id,
        consent,
        extra
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, created_at
      `,
      [
        sessionId || null,
        clientId,
        source.trim(),
        name.trim(),
        normalizedPhoneCountryCode,
        normalizedPhoneNumber,
        normalizedEmail,
        normalizedPreferredContactMethod,
        normalizedComment,
        language || 'ru',
        normalizedPropertyId,
        consent,
        normalizedExtra
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      throw new Error('Failed to create lead: no rows returned');
    }

    return {
      id: result.rows[0].id,
      created_at: result.rows[0].created_at
    };
  } catch (err) {
    // Если это ошибка валидации, пробрасываем её дальше
    if (err.message && (
      err.message.includes('is required') ||
      err.message.includes('must be') ||
      err.message.includes('at least one')
    )) {
      throw err;
    }

    // Для ошибок БД логируем и пробрасываем с понятным сообщением
    console.error('❌ Database error in createLead:', err);
    throw new Error(`Database error: ${err.message}`);
  }
}

