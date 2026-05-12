function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => asText(v)).filter(Boolean).join(', ');
  return '';
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
    locationsRaw: src.locationsRaw,
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

export function buildLeadRichSummaryFromSessionPayload(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const insights = findLastInsights(messages);
  const lastUserIntent = findLastUserIntent(messages);
  const lastShownCardId = findLastShownCardId(messages);
  const cardsStats = countShownCards(messages);

  const userCount = messages.filter((m) => String(m?.role || m?.type || '').toLowerCase() === 'user').length;
  const assistantCount = messages.filter((m) => String(m?.role || m?.type || '').toLowerCase() === 'assistant').length;

  const insightPairs = [];
  if (insights) {
    Object.entries(insights).forEach(([k, v]) => {
      const t = asText(v);
      if (!t) return;
      insightPairs.push(`${k}: ${t}`);
    });
  }

  const lines = [];
  if (lastUserIntent) lines.push(`ПОСЛЕДНИЙ ЗАПРОС: ${lastUserIntent}`);
  if (insightPairs.length) lines.push(`ИНСАЙТЫ: ${insightPairs.join(' | ')}`);
  if (lastShownCardId) lines.push(`ПОСЛЕДНИЙ ПОКАЗАННЫЙ ОБЪЕКТ: ${lastShownCardId}`);
  lines.push(`МЕТРИКИ: user_msgs=${userCount}, assistant_msgs=${assistantCount}, shown_cards_total=${cardsStats.total}, shown_cards_unique=${cardsStats.unique}`);

  return {
    summaryText: lines.join('\n'),
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

