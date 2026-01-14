// services/telegramNotifier.js
// Telegram notifier for new leads (best-effort, demo-safe).
// ВАЖНО:
// - если ENV не задан — молча пропускаем
// - любые ошибки Telegram не должны ломать основной поток
// - токен никогда не логируем

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

export function buildLeadTelegramMessage(lead) {
  const createdAt = lead?.createdAt
    ? new Date(lead.createdAt).toISOString()
    : new Date().toISOString();

  const lines = [];
  lines.push('🆕 New lead');
  lines.push('');
  lines.push(`source: ${clip(lead?.source || '-')}`);
  lines.push(`name: ${clip(lead?.name || '-')}`);

  const phone = normalizePhone(lead?.phoneCountryCode, lead?.phoneNumber);
  if (phone) lines.push(`phone: ${clip(phone)}`);
  if (lead?.email) lines.push(`email: ${clip(lead.email)}`);

  if (lead?.preferredContactMethod) {
    lines.push(`preferredContactMethod: ${clip(lead.preferredContactMethod)}`);
  }
  if (lead?.language) lines.push(`language: ${clip(lead.language)}`);
  lines.push(`consent: ${lead?.consent === true ? 'true' : 'false'}`);

  if (lead?.comment) {
    lines.push('');
    lines.push(`comment: ${clip(lead.comment, 1200)}`);
  }

  if (lead?.sessionId) lines.push(`sessionId: ${clip(lead.sessionId)}`);
  if (lead?.propertyId) lines.push(`propertyId: ${clip(lead.propertyId)}`);
  if (lead?.leadId) lines.push(`leadId: ${clip(lead.leadId)}`);
  lines.push(`createdAt: ${createdAt}`);

  return lines.join('\n');
}

export async function notifyLeadToTelegram(lead) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return { ok: false, skipped: true };

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

