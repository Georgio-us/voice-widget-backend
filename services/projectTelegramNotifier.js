import { pool } from './db.js';
import {
  buildLeadTelegramMessage,
  buildNewTelegramUserMessage,
  buildSessionActivityStartMessage,
  buildSessionActivityFinalMessage
} from './telegramNotifier.js';

const clip = (v, n = 400) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const normalize = (v) => String(v || '').trim();

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

const resolveNotifierClientId = () =>
  String(process.env.BOT_CLIENT_ID || process.env.CLIENT_ID || 'demo').trim() || 'demo';

const resolveProjectRecipientIds = () => {
  const raw = [process.env.OWNER_TG_ID, process.env.SUPER_ADMIN_ID]
    .map((v) => normalize(v))
    .filter(Boolean);
  const ids = Array.from(new Set(raw))
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  return ids.map((v) => String(v));
};

async function getAlertsConfigForUser(tgUserId) {
  const safeTg = Number(tgUserId);
  if (!Number.isFinite(safeTg)) return { leads: true, activity: true };
  try {
    const { rows } = await pool.query(
      `
      SELECT meta
      FROM users
      WHERE client_id = $1 AND tg_user_id = $2
      LIMIT 1
      `,
      [resolveNotifierClientId(), safeTg]
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

async function sendToRecipient({ token, chatId, text }) {
  const { data } = await telegramCall({
    token,
    method: 'sendMessage',
    payload: {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    }
  });
  return { messageId: data?.result?.message_id || null };
}

export async function notifyLeadToProjectTelegram(lead) {
  const token = normalize(process.env.TELEGRAM_INTERACTIVE_TOKEN);
  const recipients = resolveProjectRecipientIds();
  if (!token || !recipients.length) {
    return { ok: false, skipped: true, reason: 'project_notifier_not_configured' };
  }

  const text = normalize(lead?.notificationText) || buildLeadTelegramMessage(lead);
  const results = [];

  for (const chatId of recipients) {
    const alerts = await getAlertsConfigForUser(chatId);
    if (!alerts.leads) {
      results.push({ chatId, ok: false, skipped: true, reason: 'alerts_leads_off' });
      continue;
    }
    try {
      await sendToRecipient({ token, chatId, text });
      results.push({ chatId, ok: true, skipped: false });
    } catch (error) {
      results.push({ chatId, ok: false, skipped: false, error: error?.message || 'send_failed' });
    }
  }

  const delivered = results.filter((x) => x.ok === true).length;
  return {
    ok: delivered > 0,
    skipped: delivered === 0 && results.every((x) => x.skipped),
    delivered,
    results
  };
}

export async function notifyNewTelegramUserToProjectTelegram(payload = {}) {
  const token = normalize(process.env.TELEGRAM_INTERACTIVE_TOKEN);
  const recipients = resolveProjectRecipientIds();
  if (!token || !recipients.length) {
    return { ok: false, skipped: true, reason: 'project_notifier_not_configured' };
  }

  const text = buildNewTelegramUserMessage(payload);
  const results = [];

  for (const chatId of recipients) {
    const alerts = await getAlertsConfigForUser(chatId);
    if (!alerts.activity) {
      results.push({ chatId, ok: false, skipped: true, reason: 'alerts_activity_off' });
      continue;
    }
    try {
      await sendToRecipient({ token, chatId, text });
      results.push({ chatId, ok: true, skipped: false });
    } catch (error) {
      results.push({ chatId, ok: false, skipped: false, error: error?.message || 'send_failed' });
    }
  }

  const delivered = results.filter((x) => x.ok === true).length;
  return {
    ok: delivered > 0,
    skipped: delivered === 0 && results.every((x) => x.skipped),
    delivered,
    results
  };
}

export async function sendSessionActivityStartToProjectTelegram(params = {}) {
  const token = normalize(process.env.TELEGRAM_INTERACTIVE_TOKEN);
  const recipients = resolveProjectRecipientIds();
  if (!token || !recipients.length) {
    return { ok: false, skipped: true, reason: 'project_notifier_not_configured', messageIds: {} };
  }

  const text = buildSessionActivityStartMessage(params);
  const actorTgId = String(params?.telegramUser?.userId || '').trim();
  const results = [];
  const messageIds = {};

  for (const chatId of recipients) {
    if (actorTgId && actorTgId === chatId) {
      results.push({ chatId, ok: false, skipped: true, reason: 'self_activity' });
      continue;
    }
    const alerts = await getAlertsConfigForUser(chatId);
    if (!alerts.activity) {
      results.push({ chatId, ok: false, skipped: true, reason: 'alerts_activity_off' });
      continue;
    }
    try {
      const { messageId } = await sendToRecipient({ token, chatId, text });
      if (messageId) messageIds[chatId] = messageId;
      results.push({ chatId, ok: true, skipped: false, messageId: messageId || null });
    } catch (error) {
      results.push({ chatId, ok: false, skipped: false, error: error?.message || 'send_failed' });
    }
  }

  const delivered = results.filter((x) => x.ok === true).length;
  return {
    ok: delivered > 0,
    skipped: delivered === 0 && results.every((x) => x.skipped),
    delivered,
    results,
    messageIds
  };
}

export async function updateSessionActivityFinalToProjectTelegram(params = {}) {
  const token = normalize(process.env.TELEGRAM_INTERACTIVE_TOKEN);
  const messageIds = params?.messageIds && typeof params.messageIds === 'object' ? params.messageIds : {};
  const chatIds = Object.keys(messageIds).filter(Boolean);
  if (!token || !chatIds.length) {
    return { ok: false, skipped: true, reason: 'project_notifier_not_configured_or_no_message_ids' };
  }

  const text = buildSessionActivityFinalMessage(params);
  const results = [];

  for (const chatId of chatIds) {
    const messageId = Number(messageIds[chatId]);
    if (!Number.isFinite(messageId)) {
      results.push({ chatId, ok: false, skipped: true, reason: 'invalid_message_id' });
      continue;
    }
    const alerts = await getAlertsConfigForUser(chatId);
    if (!alerts.activity) {
      results.push({ chatId, ok: false, skipped: true, reason: 'alerts_activity_off' });
      continue;
    }
    try {
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
      results.push({ chatId, ok: true, skipped: false });
    } catch (error) {
      results.push({ chatId, ok: false, skipped: false, error: error?.message || 'edit_failed' });
    }
  }

  const delivered = results.filter((x) => x.ok === true).length;
  return {
    ok: delivered > 0,
    skipped: delivered === 0 && results.every((x) => x.skipped),
    delivered,
    results
  };
}
