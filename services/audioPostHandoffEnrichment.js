export const parseEmailFromText = (text) => {
  const m = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
};

export const parsePhoneFromText = (text) => {
  // Allow +, spaces, dashes, parentheses; normalize to +digits.
  const m = String(text || '').match(/\+?\s*[0-9][0-9\s()\-]{5,}/);
  if (!m) return null;
  const digits = m[0].replace(/[^0-9+]/g, '');
  const normalized = `+${digits.replace(/^\++/,'')}`;
  return normalized.length >= 7 ? normalized : null;
};

export const parseTimeWindowFromText = (text) => {
  try {
    const lower = String(text || '').toLowerCase();
    const tz = 'Europe/Madrid';
    const now = new Date();
    const todayStr = new Date(now).toLocaleString('sv-SE', { timeZone: tz }).slice(0,10);
    const tomorrow = new Date(now.getTime() + 24*60*60*1000);
    const tomorrowStr = tomorrow.toLocaleString('sv-SE', { timeZone: tz }).slice(0,10);

    const isToday = /(сегодня|today)/i.test(lower);
    const isTomorrow = /(завтра|tomorrow)/i.test(lower);

    const timeSingle = lower.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
    const timeRange = lower.match(/\b(\d{1,2})\s*[–\-]\s*(\d{1,2})\b/);

    let date = null; let from = null; let to = null;
    if (isToday) date = todayStr; else if (isTomorrow) date = tomorrowStr;
    if (timeRange) { from = `${timeRange[1].padStart(2,'0')}:00`; to = `${timeRange[2].padStart(2,'0')}:00`; }
    else if (timeSingle) { from = `${timeSingle[1].padStart(2,'0')}:${(timeSingle[2]||'00')}`; to = null; }

    if (date && (from || to)) return { date, from, to, timezone: tz };
    return null;
  } catch { return null; }
};

export const addPostHandoffEnrichment = (session, source, content, meta = {}) => {
  if (!session || !session.handoffDone) return;

  if (!Array.isArray(session.postHandoffEnrichment)) {
    session.postHandoffEnrichment = [];
  }

  session.postHandoffEnrichment.push({
    at: Date.now(),
    source,
    content,
    meta
  });

  console.log(`📝 [Sprint III] Post-handoff enrichment добавлен (source: ${source}, сессия ${session.sessionId?.slice(-8) || 'unknown'})`);
};
