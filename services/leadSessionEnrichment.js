import { OpenAI } from 'openai';

let openaiClient = null;

function getOpenAIClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

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

function getMessageText(msg) {
  return firstNonEmpty(
    msg?.content,
    msg?.text,
    msg?.message,
    msg?.payload?.text,
    msg?.payload?.message
  );
}

function collectDialogForAiSummary(messages = []) {
  const dialog = [];
  for (const msg of messages) {
    const roleRaw = String(msg?.role || msg?.type || '').toLowerCase();
    const role = roleRaw === 'assistant' ? 'assistant' : roleRaw === 'user' ? 'user' : '';
    if (!role) continue;
    const text = getMessageText(msg);
    if (!text) continue;
    dialog.push({
      role,
      text: text.length > 900 ? `${text.slice(0, 900)}...` : text
    });
  }
  return dialog.slice(-28);
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
  const preferences = joinList(insights?.preferences);
  const details = joinList(insights?.details);

  if (type) entries.push(`${t.type}: ${type}`);
  if (op) entries.push(`${t.operation}: ${op}`);
  if (location) entries.push(`${t.location}: ${location}`);
  if (rooms) entries.push(`${t.rooms}: ${rooms}`);
  if (budget) entries.push(`${t.budget}: ${budget}`);
  if (features) entries.push(`${t.features}: ${features}`);
  if (preferences && preferences !== features) entries.push(`${t.features}: ${preferences}`);
  if (details && details !== preferences && details !== features) entries.push(`${t.features}: ${details}`);

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

function buildAiSummaryInput({ deterministic, dialog }) {
  return JSON.stringify({
    deterministicSnapshot: {
      insights: deterministic?.insights || null,
      lastShownCardId: deterministic?.lastShownCardId || null,
      metrics: deterministic?.metrics || null,
      fallbackSummary: deterministic?.summaryText || null
    },
    dialog
  }, null, 2);
}

export async function buildLeadAiSummaryFromSessionPayload(payload, preferredLanguage = null) {
  const deterministic = buildLeadRichSummaryFromSessionPayload(payload, preferredLanguage);
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const dialog = collectDialogForAiSummary(messages);
  const client = getOpenAIClient();

  if (!client || dialog.length === 0) {
    return {
      ...deterministic,
      summaryMode: client ? 'deterministic_empty_dialog' : 'deterministic_no_openai'
    };
  }

  try {
    const model = String(
      process.env.LEAD_SUMMARY_MODEL ||
      process.env.OPENAI_SUMMARY_MODEL ||
      process.env.OPENAI_MODEL ||
      'gpt-4o-mini'
    ).trim();

    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.2,
        max_tokens: 420,
        messages: [
          {
            role: 'system',
            content: [
              'Ты готовишь краткое резюме заявки для менеджера агентства недвижимости.',
              'Пиши на русском языке, даже если клиент писал на другом языке.',
              'Не психоанализируй клиента и не давай советов менеджеру по эмоциям.',
              'Вытащи только практический контекст: что клиент искал, аренда/покупка если ясно, бюджет/финансовый контекст, локации, тип объекта, важные пожелания, что уже произошло в диалоге, какой следующий шаг.',
              'Не выдумывай факты. Если данных нет, так и напиши.',
              'Формат: 4-8 коротких пунктов без markdown-таблиц.'
            ].join(' ')
          },
          {
            role: 'user',
            content: buildAiSummaryInput({ deterministic, dialog })
          }
        ]
      },
      { timeout: 8000 }
    );

    const summaryText = asText(completion?.choices?.[0]?.message?.content);
    if (!summaryText) {
      return { ...deterministic, summaryMode: 'deterministic_empty_ai' };
    }

    return {
      ...deterministic,
      summaryText,
      summaryMode: 'ai'
    };
  } catch (err) {
    console.warn('[lead-summary] AI summary failed, using deterministic fallback', err?.message || err);
    return {
      ...deterministic,
      summaryMode: 'deterministic_ai_failed'
    };
  }
}
