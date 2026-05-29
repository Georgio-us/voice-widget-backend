// services/telegramNotifier.js
// Telegram notifier for new leads (best-effort, demo-safe).
// ВАЖНО:
// - если ENV не задан — молча пропускаем
// - любые ошибки Telegram не должны ломать основной поток
// - токен никогда не логируем
import { pool } from './db.js';

const clip = (v, n = 800) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};

const normalizePhone = (cc, num) => {
  const a = cc ? String(cc).trim() : '';
  const b = num ? String(num).trim() : '';
  const joined = `${a}${b}`.replace(/\s+/g, '');
  return joined || '';
};

const normalizeTelegramId = (value) => {
  const v = String(value ?? '').trim();
  if (!v) return '';
  return /^-?\d{5,20}$/.test(v) ? v : '';
};

const formatPhoneHuman = (raw = '') => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.replace(/\s+/g, '').match(/^\+?(\d{1,3})(\d{9})$/);
  if (!m) return s;
  const cc = m[1];
  const n = m[2];
  // group 3-3-3 for 9-digit national numbers (e.g., Spain)
  return `+${cc} ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
};

const safeToIso = (v) => {
  // Accept Date | number | ISO string; fallback to now.
  try {
    if (!v) return new Date().toISOString();
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isFinite(t) ? v.toISOString() : new Date().toISOString();
    }
    const d = new Date(v);
    const t = d.getTime();
    return Number.isFinite(t) ? d.toISOString() : new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const formatDateRu = (isoLike) => {
  const iso = safeToIso(isoLike);
  try {
    const d = new Date(iso);
    const dd = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
    // ru-RU usually "07.02.2026, 11:44"
    return dd;
  } catch {
    return iso;
  }
};

const formatLanguageLabel = (lang) => {
  const v = String(lang || '').trim().toLowerCase();
  if (!v) return '';
  const map = {
    ru: 'Русский',
    ua: 'Українська',
    en: 'English',
    es: 'Español',
    uk: 'Українська',
    fr: 'Français',
    de: 'Deutsch',
    it: 'Italiano'
  };
  return map[v] || v;
};

const pickInsightLines = (insights) => {
  if (!insights || typeof insights !== 'object' || Array.isArray(insights)) return [];
  const lines = [];
  const add = (label, value) => {
    const v = value === null || value === undefined ? '' : String(value).trim();
    if (!v) return;
    // skip default-ish values
    if (v.toLowerCase() === 'не определено' || v.toLowerCase() === 'не определен' || v.toLowerCase() === 'не определена') return;
    lines.push(`• ${label}: ${clip(v, 200)}`);
  };
  add('Операция', insights.operation);
  add('Тип объекта', insights.type);
  add('Локация', insights.location);
  add('Комнаты', insights.rooms);
  add('Бюджет', insights.budget);
  add('Площадь', insights.area);
  add('Детали', insights.details);
  add('Предпочтения', insights.preferences);
  return lines;
};

const resolveNotifierClientId = () =>
  String(process.env.BOT_CLIENT_ID || process.env.CLIENT_ID || 'demo').trim() || 'demo';

const normalizeAlertsMode = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (['off', 'none', '0', 'false'].includes(v)) return 'off';
  if (['basic'].includes(v)) return 'basic';
  if (['on', 'full', 'all', '1', 'true'].includes(v)) return 'full';
  return '';
};

const normalizeBool = (value, fallback = true) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'y'].includes(v)) return true;
  if (['0', 'false', 'off', 'no', 'n'].includes(v)) return false;
  return Boolean(fallback);
};

async function getAdminAlertsConfig() {
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  const tgUserId = Number(chatId);
  if (!Number.isFinite(tgUserId)) return { leads: true, activity: true };
  try {
    const { rows } = await pool.query(
      `
      SELECT meta
      FROM users
      WHERE client_id = $1 AND tg_user_id = $2
      LIMIT 1
      `,
      [resolveNotifierClientId(), tgUserId]
    );
    const meta = rows?.[0]?.meta && typeof rows[0].meta === 'object' ? rows[0].meta : {};
    const alerts = meta?.telegram_alerts && typeof meta.telegram_alerts === 'object' ? meta.telegram_alerts : {};
    const legacyMode = normalizeAlertsMode(alerts.mode || '');
    if (legacyMode === 'off') return { leads: false, activity: false };
    if (legacyMode === 'basic') return { leads: true, activity: false };
    if (legacyMode === 'full') return { leads: true, activity: true };
    return {
      leads: normalizeBool(alerts.leads, true),
      activity: normalizeBool(alerts.activity, true)
    };
  } catch (error) {
    if (error?.code === '42P01') return { leads: true, activity: true };
    return { leads: true, activity: true };
  }
}

export function buildLeadTelegramMessage(lead) {
  const lines = [];
  const source = String(lead?.source || '').trim().toLowerCase();
  const propertyId = String(lead?.propertyId || lead?.lastShownCardId || '').trim();
  if (source.startsWith('guest_want_bot')) {
    lines.push('🚨🚨🚨 ЗАЯВКА: ХОЧУ ТАКОГО БОТА 🚨🚨🚨');
    if (source === 'guest_want_bot_trial') lines.push('🧪 Канал: 7-дневный тест');
    else if (source === 'guest_want_bot_consult') lines.push('🗣️ Канал: консультация');
    else lines.push('📩 Канал: хочу такого бота');
  } else if (source.startsWith('guest_want_sell')) {
    lines.push('🏠🏠🏠 ЗАЯВКА: ХОЧУ ПРОДАТЬ НЕДВИЖИМОСТЬ 🏠🏠🏠');
    if (source === 'guest_want_sell_submit') lines.push('🏠 Канал: кнопка "Хочу продати"');
    else if (source === 'guest_want_sell_estimate') lines.push('💰 Канал: кнопка "Оцінити вартість"');
    else lines.push('📩 Канал: хочу продать');
  } else if (source === 'tg_property_card') {
    lines.push(`🔥 ИНТЕРЕС К ОБЪЕКТУ: ${propertyId || '-'}`);
  } else if (source === 'tg_header_main') {
    lines.push('📞 ОБЩАЯ КОНСУЛЬТАЦИЯ (из хедера)');
  } else {
    lines.push('🆕 Новая заявка с виджета');
  }
  lines.push('');

  // Client
  lines.push('👤 Клиент:');
  lines.push(clip(lead?.name || '-', 200));
  const telegramUsernameRaw = String(lead?.telegramUsername || '').trim();
  if (telegramUsernameRaw) {
    const telegramUsername = telegramUsernameRaw.startsWith('@')
      ? telegramUsernameRaw
      : `@${telegramUsernameRaw}`;
    lines.push(`Telegram: ${clip(telegramUsername, 100)}`);
  }
  const tgUserId = normalizeTelegramId(lead?.tgUserId);
  if (tgUserId) {
    lines.push(`Telegram ID: ${clip(tgUserId, 40)}`);
  }
  lines.push('');

  // Contacts
  const rawPhone = normalizePhone(lead?.phoneCountryCode, lead?.phoneNumber);
  if (rawPhone) {
    lines.push('📞 Телефон:');
    lines.push(formatPhoneHuman(rawPhone));
    lines.push('');
  }
  if (lead?.email) {
    lines.push('✉️ Email:');
    lines.push(clip(lead.email, 300));
    lines.push('');
  }

  const langLabel = formatLanguageLabel(lead?.language);
  if (langLabel) {
    lines.push('🌍 Язык общения:');
    lines.push(langLabel);
    lines.push('');
  }

  // Request block (insights + references)
  const requestLines = [];
  // existing reference from lead payload
  if (lead?.propertyId) {
    requestLines.push(`• Объект ID: ${clip(lead.propertyId, 80)}`);
  }
  // last shown card id from session logs (existing logged cards)
  if (!lead?.propertyId && lead?.lastShownCardId) requestLines.push(`• Показанный объект ID: ${clip(lead.lastShownCardId, 80)}`);
  if (lead?.propertyUrl) requestLines.push(`• Ссылка на объект: ${clip(lead.propertyUrl, 500)}`);
  if (lead?.propertySummary?.summary) requestLines.push(`• Объект: ${clip(lead.propertySummary.summary, 500)}`);
  if (lead?.propertySummary?.title) requestLines.push(`• Заголовок: ${clip(lead.propertySummary.title, 500)}`);
  requestLines.push(...pickInsightLines(lead?.insights));
  if (requestLines.length) {
    lines.push('🏠 Запрос:');
    lines.push(...requestLines);
    lines.push('');
  }

  if (lead?.comment) {
    lines.push('📝 Комментарий:');
    lines.push(clip(lead.comment, 1200));
    lines.push('');
  }

  // Date
  lines.push('🕒 Дата заявки:');
  lines.push(formatDateRu(lead?.createdAt));

  // Internal refs (keep short)
  const refs = [];
  if (lead?.source) refs.push(`source=${clip(lead.source, 80)}`);
  if (lead?.preferredContactMethod) refs.push(`method=${clip(lead.preferredContactMethod, 40)}`);
  if (lead?.sessionId) refs.push(`sid=${clip(lead.sessionId, 80)}`);
  if (lead?.leadId) refs.push(`leadId=${clip(lead.leadId, 40)}`);
  if (refs.length) {
    lines.push('');
    lines.push(`🔧 ${refs.join(' | ')}`);
  }

  return lines.join('\n').trim();
}

export async function notifyLeadToTelegram(lead) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return { ok: false, skipped: true };
  const alerts = await getAdminAlertsConfig();
  if (!alerts.leads) return { ok: false, skipped: true, reason: 'alerts_leads_off' };

  const text = buildLeadTelegramMessage(lead);

  // Node 18+ has fetch, but keep a clear error if missing.
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is not available (requires Node 18+)');
  }

  const controller = new AbortController();
  const timeoutMs = 5000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      let hint = '';
      try {
        const body = await res.text();
        hint = body ? ` body=${clip(body, 300)}` : '';
      } catch {}
      throw new Error(`Telegram sendMessage failed: ${res.status}${hint}`);
    }

    return { ok: true, skipped: false };
  } finally {
    clearTimeout(t);
  }
}

export const buildNewTelegramUserMessage = (payload = {}) => {
  const lines = [];
  lines.push('🆕 Новый пользователь добавлен в бота');
  lines.push('');
  const tgLines = buildTelegramUserLines({
    userId: payload?.tgUserId,
    username: payload?.username,
    firstName: payload?.firstName,
    lastName: payload?.lastName
  });
  if (tgLines.length) {
    lines.push(...tgLines);
  }
  if (typeof payload?.totalUsers === 'number') {
    lines.push(`👥 Всего пользователей: ${payload.totalUsers}`);
  }
  if (typeof payload?.usersToday === 'number') {
    lines.push(`📈 Новых за сегодня: ${payload.usersToday}`);
  }
  lines.push(`🕒 Время: ${formatDateRu(payload?.at || Date.now())}`);
  return lines.join('\n').trim();
};

export async function notifyNewTelegramUserToTelegram(payload = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return { ok: false, skipped: true };
  const alerts = await getAdminAlertsConfig();
  if (!alerts.activity) return { ok: false, skipped: true, reason: 'alerts_activity_off' };

  const text = buildNewTelegramUserMessage(payload);
  await telegramCall({
    token,
    method: 'sendMessage',
    payload: {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    }
  });
  return { ok: true, skipped: false };
}

// ------------------------------------------------------------
// RMv3: Telegram "session activity" messages (best-effort).
// Telegram is UI only; server remains source of truth.
// ------------------------------------------------------------

const formatDurationHumanRu = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '0 мин';
  const totalSec = Math.floor(n / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h <= 0) return `${Math.max(1, m)} мин`;
  const mm = String(m).padStart(2, '0');
  return `${h} ч ${mm} мин`;
};

const buildGeoLine = (geo) => {
  const country = geo?.country ? String(geo.country).trim() : '';
  const city = geo?.city ? String(geo.city).trim() : '';
  if (!country && !city) return '';
  if (country && city) return `${country}, ${city}`;
  return country || city;
};

const buildTelegramUserLines = (tgUser) => {
  const lines = [];
  const userId = tgUser?.userId ? String(tgUser.userId).trim() : '';
  const usernameRaw = tgUser?.username ? String(tgUser.username).trim() : '';
  const firstName = tgUser?.firstName ? String(tgUser.firstName).trim() : '';
  const lastName = tgUser?.lastName ? String(tgUser.lastName).trim() : '';
  const username = usernameRaw
    ? (usernameRaw.startsWith('@') ? usernameRaw : `@${usernameRaw}`)
    : '';
  const fullName = `${firstName} ${lastName}`.trim();
  if (userId) lines.push(`🆔 Telegram ID: ${clip(userId, 80)}`);
  if (username) lines.push(`👤 Telegram: ${clip(username, 100)}`);
  if (fullName) lines.push(`🙍 Имя: ${clip(fullName, 120)}`);
  return lines;
};

export const buildSessionActivityStartMessage = (p = {}) => {
  const lines = [];
  lines.push('🟢 Кто-то пользуется виджетом прямо сейчас');
  lines.push('');
  if (p.sessionId) {
    lines.push(`🧾 Сессия: ${clip(p.sessionId, 120)}`);
  }
  if (p.startedAt != null) {
    lines.push(`🕒 Начало: ${formatDateRu(p.startedAt)}`);
  }
  const geoLine = buildGeoLine(p.geo);
  if (geoLine) {
    lines.push(`🌍 Гео: ${clip(geoLine, 120)}`);
  }
  const tgLines = buildTelegramUserLines(p.telegramUser);
  if (tgLines.length) {
    lines.push(...tgLines);
  }
  if (typeof p.messageCount === 'number') {
    lines.push(`💬 Сообщений: ${p.messageCount}`);
  }
  return lines.join('\n').trim();
};

export const buildSessionActivityFinalMessage = (p = {}) => {
  const lines = [];
  lines.push('✅ Была зафиксирована активность пользователя');
  lines.push('');
  if (p.sessionId) {
    lines.push(`🧾 Сессия: ${clip(p.sessionId, 120)}`);
  }
  if (p.startedAt != null) {
    lines.push(`🕒 Начало: ${formatDateRu(p.startedAt)}`);
  }
  if (p.lastActivityAt != null) {
    lines.push(`⏱️ Последняя активность: ${formatDateRu(p.lastActivityAt)}`);
  }
  const geoLine = buildGeoLine(p.geo);
  if (geoLine) {
    lines.push(`🌍 Гео: ${clip(geoLine, 120)}`);
  }
  if (typeof p.durationMs === 'number') {
    lines.push(`⌛ Длительность: ${formatDurationHumanRu(p.durationMs)}`);
  }
  if (typeof p.messageCount === 'number') {
    lines.push(`💬 Сообщений: ${p.messageCount}`);
  }
  if (p.sliderReached === true) {
    lines.push('🧩 Дошёл до слайдера: да');
  } else if (p.sliderReached === false) {
    lines.push('🧩 Дошёл до слайдера: нет');
  }
  const insightLines = pickInsightLines(p.insights);
  if (insightLines.length) {
    lines.push('');
    lines.push('🧠 Инсайты:');
    lines.push(...insightLines);
  }
  // Cards (best-effort, business-useful)
  if (typeof p.cardsShownCount === 'number' || typeof p.likesCount === 'number' || p.selectedCardId) {
    lines.push('');
    lines.push('🏠 Карточки:');
    if (typeof p.cardsShownCount === 'number') lines.push(`• Показано: ${p.cardsShownCount}`);
    if (typeof p.likesCount === 'number') lines.push(`• Лайков: ${p.likesCount}`);
    if (p.selectedCardId) lines.push(`• Выбран объект: ${clip(p.selectedCardId, 80)}`);
  }
  // Handoff facts (best-effort)
  if (p.handoffActive === true || p.handoffCanceled === true) {
    lines.push('');
    lines.push('🤝 Handoff:');
    if (p.handoffActive === true) lines.push('• Активирован: да');
    if (p.handoffCanceled === true) lines.push('• Отменён: да');
  }

  return lines.join('\n').trim();
};

const telegramCall = async ({ token, method, payload, timeoutMs = 5000 }) => {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is not available (requires Node 18+)');
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      let hint = '';
      try {
        const body = await res.text();
        hint = body ? ` body=${clip(body, 300)}` : '';
      } catch {}
      throw new Error(`Telegram ${method} failed: ${res.status}${hint}`);
    }
    const data = await res.json().catch(() => null);
    return { ok: true, data };
  } finally {
    clearTimeout(t);
  }
};

export async function sendSessionActivityStartToTelegram(params = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return { ok: false, skipped: true, messageId: null };
  const alerts = await getAdminAlertsConfig();
  if (!alerts.activity) return { ok: false, skipped: true, messageId: null, reason: 'alerts_activity_off' };
  const actorTgId = String(params?.telegramUser?.userId || '').trim();
  if (actorTgId && actorTgId === chatId) {
    return { ok: false, skipped: true, messageId: null, reason: 'self_activity' };
  }

  const text = buildSessionActivityStartMessage(params);
  const { data } = await telegramCall({
    token,
    method: 'sendMessage',
    payload: {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    }
  });
  const messageId = data?.result?.message_id || null;
  return { ok: true, skipped: false, messageId };
}

export async function updateSessionActivityFinalToTelegram(params = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  const messageId = params?.messageId || null;
  if (!token || !chatId || !messageId) return { ok: false, skipped: true };
  const alerts = await getAdminAlertsConfig();
  if (!alerts.activity) return { ok: false, skipped: true, reason: 'alerts_activity_off' };

  const text = buildSessionActivityFinalMessage(params);
  await telegramCall({
    token,
    method: 'editMessageText',
    payload: {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true
    }
  });
  return { ok: true, skipped: false };
}
