// models/lead.js
// Модель лида: структура, конструктор, валидация. ES-модули.

/**
 * Поддерживаемые статусы лида
 */
export const LEAD_STATUSES = Object.freeze({
  NEW: 'new',
  CONTACT_REQUESTED: 'contact_requested',
  SCHEDULED: 'scheduled',
  CLOSED: 'closed'
});

/**
 * Поддерживаемые каналы связи
 */
export const LEAD_CHANNELS = Object.freeze({
  PHONE: 'phone',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email'
});

/**
 * Поддерживаемые языки (локали UI/коммуникации)
 */
export const SUPPORTED_LANGUAGES = ['en', 'es', 'ru', 'uk', 'fr', 'de', 'it'];

const PHONE_REGEX = /^[+]?\d[\d\s().-]{6,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const TIME_REGEX = /^\d{2}:\d{2}$/;        // HH:mm

/**
 * Генерация ID лида
 */
export function generateLeadId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `lead_${Date.now()}_${rand}`;
}

/**
 * Нормализация языка: приводит к поддерживаемому 2-буквенному коду
 * @param {string|undefined} lang
 * @returns {string}
 */
export function normalizeLanguage(lang) {
  if (!lang || typeof lang !== 'string') return 'en';
  const code = lang.trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(code) ? code : 'en';
}

/**
 * Нормализация канала и контакта
 * @param {{ channel: string, value: string }} contact
 */
function normalizeContact(contact) {
  if (!contact || typeof contact !== 'object') return { channel: null, value: null, error: 'CONTACT_REQUIRED' };
  const channel = String(contact.channel || '').toLowerCase();
  const value = String(contact.value || '').trim();

  switch (channel) {
    case LEAD_CHANNELS.EMAIL: {
      if (!EMAIL_REGEX.test(value)) return { channel, value, error: 'INVALID_EMAIL' };
      return { channel, value };
    }
    case LEAD_CHANNELS.PHONE:
    case LEAD_CHANNELS.WHATSAPP: {
      if (!PHONE_REGEX.test(value)) return { channel, value, error: 'INVALID_PHONE' };
      return { channel, value };
    }
    default:
      return { channel: null, value, error: 'UNSUPPORTED_CHANNEL' };
  }
}

/**
 * Нормализация временного окна для звонка
 * @param {{ date?: string, from?: string, to?: string, timezone?: string }|undefined} input
 */
function normalizeTimeWindow(input) {
  if (!input || typeof input !== 'object') return null;
  const date = input.date ? String(input.date).trim() : undefined;
  const from = input.from ? String(input.from).trim() : undefined;
  const to = input.to ? String(input.to).trim() : undefined;
  const timezone = input.timezone ? String(input.timezone).trim() : undefined;

  const out = {};
  if (date) {
    if (!DATE_REGEX.test(date)) return { error: 'INVALID_DATE' };
    out.date = date;
  }
  if (from) {
    if (!TIME_REGEX.test(from)) return { error: 'INVALID_TIME_FROM' };
    out.from = from;
  }
  if (to) {
    if (!TIME_REGEX.test(to)) return { error: 'INVALID_TIME_TO' };
    out.to = to;
  }
  if (timezone) out.timezone = timezone;
  return Object.keys(out).length ? out : null;
}

/**
 * Валидация входных данных лида и подготовка нормализованной структуры
 * @param {object} input
 * @returns {{ valid: boolean, errors: string[], normalized?: object }}
 */
export function validateLeadInput(input) {
  const errors = [];
  const name = (input && typeof input.name === 'string') ? input.name.trim() : '';
  if (!name) errors.push('NAME_REQUIRED');

  const contact = normalizeContact(input?.contact);
  if (contact.error) errors.push(contact.error);

  const timeWindow = normalizeTimeWindow(input?.time_window);
  if (timeWindow && timeWindow.error) errors.push(timeWindow.error);

  const language = normalizeLanguage(input?.language);

  const gdprConsent = Boolean(input?.gdpr?.consent);
  if (!gdprConsent) errors.push('GDPR_CONSENT_REQUIRED');

  const status = LEAD_STATUSES.NEW;
  const createdAt = new Date().toISOString();

  const context = {
    sessionId: input?.context?.sessionId || null,
    insights: input?.context?.insights || null,
    notes: input?.context?.notes || null,
    source: input?.context?.source || 'widget',
    metadata: input?.context?.metadata || null
  };

  const normalized = {
    id: generateLeadId(),
    status,
    created_at: createdAt,
    name,
    contact: contact.error ? { channel: null, value: null } : { channel: contact.channel, value: contact.value },
    time_window: (timeWindow && !timeWindow.error) ? timeWindow : null,
    language,
    gdpr: {
      consent: gdprConsent,
      consent_at: gdprConsent ? createdAt : null,
      locale: language
    },
    context
  };

  return { valid: errors.length === 0, errors, normalized };
}

/**
 * Создание лида с валидацией. Бросает ошибку при невалидных данных.
 * @param {object} input
 * @returns {object} lead
 */
export function createLead(input) {
  const { valid, errors, normalized } = validateLeadInput(input);
  if (!valid) {
    const err = new Error('INVALID_LEAD_INPUT');
    err.errors = errors;
    throw err;
  }
  return normalized;
}

export default {
  LEAD_STATUSES,
  LEAD_CHANNELS,
  SUPPORTED_LANGUAGES,
  generateLeadId,
  normalizeLanguage,
  validateLeadInput,
  createLead
};


