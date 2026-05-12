function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => asText(v)).filter(Boolean).join(', ');
  return '';
}

function normalizeLang(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v.startsWith('es')) return 'es';
  if (v.startsWith('en')) return 'en';
  return 'ru';
}

function compactObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string' && v.trim() === '') return;
    if (Array.isArray(v) && v.length === 0) return;
    out[k] = v;
  });
  return out;
}

function pickMeaningfulInsights(rawInsights) {
  const src = compactObject(rawInsights);
  return compactObject({
    operation: src.operation,
    type: src.type,
    location: src.location,
    budget: src.budget,
    budgetMin: src.budgetMin,
    budgetMax: src.budgetMax,
    rooms: src.rooms,
    bathrooms: src.bathrooms,
    area: src.area,
    features: src.features,
    preferences: src.preferences,
    details: src.details
  });
}

function findLastInsights(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const candidate = msg?.meta?.insights;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const picked = pickMeaningfulInsights(candidate);
      if (Object.keys(picked).length > 0) return picked;
    }
  }
  return null;
}

function findLastUserIntent(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const role = String(msg?.role || msg?.type || '').toLowerCase();
    if (role !== 'user') continue;
    const text = asText(msg?.content || msg?.text);
    if (text) return text;
  }
  return '';
}

function findLastShownCardId(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const cards = Array.isArray(messages[i]?.cards) ? messages[i].cards : [];
    const id = cards?.[0]?.id;
    if (id !== null && id !== undefined && String(id).trim() !== '') return String(id).trim();
  }
  return '';
}

function countShownCards(messages = []) {
  let total = 0;
  const uniq = new Set();
  for (const msg of messages) {
    const cards = Array.isArray(msg?.cards) ? msg.cards : [];
    for (const c of cards) {
      const id = c?.id;
      if (id === null || id === undefined) continue;
      total += 1;
      uniq.add(String(id));
    }
  }
  return { total, unique: uniq.size };
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const t = asText(v);
    if (t) return t;
  }
  return '';
}

function prettyBudget(insights) {
  if (!insights || typeof insights !== 'object') return '';
  const min = asText(insights.budgetMin);
  const max = asText(insights.budgetMax);
  const single = asText(insights.budget);
  if (min && max) return `${min} - ${max}`;
  if (min) return min;
  if (max) return max;
  return single;
}

function joinList(value) {
  if (Array.isArray(value)) return value.map((v) => asText(v)).filter(Boolean).join(', ');
  return asText(value);
}

function buildReadableSummary({ lang, insights, lastUserIntent, lastShownCardId, metrics }) {
  const t = {
    ru: {
      lastRequest: 'Последний запрос',
      need: 'Что ищет клиент',
      type: 'Тип',
      operation: 'Операция',
      location: 'Локация',
      rooms: 'Комнаты',
      budget: 'Бюджет',
      features: 'Пожелания',
      shown: 'Показанный объект',
      dialog: 'Диалог'
    },
    es: {
      lastRequest: 'Última solicitud',
      need: 'Qué busca el cliente',
      type: 'Tipo',
      operation: 'Operación',
      location: 'Ubicación',
      rooms: 'Habitaciones',
      budget: 'Presupuesto',
      features: 'Preferencias',
      shown: 'Último inmueble mostrado',
      dialog: 'Diálogo'
    },
    en: {
      lastRequest: 'Last request',
      need: 'Client needs',
      type: 'Type',
      operation: 'Operation',
      location: 'Location',
      rooms: 'Rooms',
      budget: 'Budget',
      features: 'Preferences',
      shown: 'Last shown property',
      dialog: 'Dialog'
    }
  }[lang] || {
    lastRequest: 'Последний запрос',
    need: 'Что ищет клиент',
    type: 'Тип',
    operation: 'Операция',
    location: 'Локация',
    rooms: 'Комнаты',
    budget: 'Бюджет',
    features: 'Пожелания',
    shown: 'Показанный объект',
    dialog: 'Диалог'
  };

  const entries = [];
  const type = asText(insights?.type);
  const op = asText(insights?.operation);
  const location = firstNonEmpty(insights?.location, insights?.locationsRaw);
  const rooms = joinList(insights?.rooms);
  const budget = prettyBudget(insights);
  const features = joinList(insights?.features);

  if (type) entries.push(`${t.type}: ${type}`);
  if (op) entries.push(`${t.operation}: ${op}`);
  if (location) entries.push(`${t.location}: ${location}`);
  if (rooms) entries.push(`${t.rooms}: ${rooms}`);
  if (budget) entries.push(`${t.budget}: ${budget}`);
  if (features) entries.push(`${t.features}: ${features}`);

  const lines = [];
  if (lastUserIntent) lines.push(`${t.lastRequest}: ${lastUserIntent}`);
  if (entries.length) lines.push(`${t.need}: ${entries.join(' · ')}`);
  if (lastShownCardId) lines.push(`${t.shown}: ${lastShownCardId}`);
  if (metrics?.userMessages || metrics?.assistantMessages) {
    lines.push(`${t.dialog}: user=${metrics.userMessages || 0}, assistant=${metrics.assistantMessages || 0}`);
  }
  return lines.length ? lines.join('\n') : '-';
}

export function buildLeadRichSummaryFromSessionPayload(payload, preferredLanguage = null) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const lang = normalizeLang(preferredLanguage || payload?.language || payload?.lang || payload?.locale);
  const insights = findLastInsights(messages);
  const lastUserIntent = findLastUserIntent(messages);
  const lastShownCardId = findLastShownCardId(messages);
  const cardsStats = countShownCards(messages);

  const userCount = messages.filter((m) => String(m?.role || m?.type || '').toLowerCase() === 'user').length;
  const assistantCount = messages.filter((m) => String(m?.role || m?.type || '').toLowerCase() === 'assistant').length;

  const summaryText = buildReadableSummary({
    lang,
    insights,
    lastUserIntent,
    lastShownCardId,
    metrics: {
      userMessages: userCount,
      assistantMessages: assistantCount,
      shownCardsTotal: cardsStats.total,
      shownCardsUnique: cardsStats.unique
    }
  });

  return {
    summaryText,
    insights,
    lastShownCardId: lastShownCardId || null,
    metrics: {
      userMessages: userCount,
      assistantMessages: assistantCount,
      shownCardsTotal: cardsStats.total,
      shownCardsUnique: cardsStats.unique
    }
  };
}
