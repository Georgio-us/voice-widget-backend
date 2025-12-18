import { File } from 'node:buffer';
globalThis.File = File;
import { OpenAI } from 'openai';
// DB repository (Postgres)
import { getAllProperties } from '../services/propertiesRepository.js';
import { BASE_SYSTEM_PROMPT } from '../services/personality.js';
import { logEvent, EventTypes, buildPayload } from '../services/eventLogger.js';
// Session-level logging: логирование целого диалога по одной строке на сессию
import { appendMessage } from '../services/sessionLogger.js';
const DISABLE_SERVER_UI = String(process.env.DISABLE_SERVER_UI || '').trim() === '1';
const ENABLE_PERIODIC_ANALYSIS = String(process.env.ENABLE_PERIODIC_ANALYSIS || '').trim() === '1';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();

// 🆕 Sprint II / Block A: Allowed Facts Schema — явный список разрешённых фактов для AI
// Определяет, какие поля карточки считаются допустимыми фактами
const ALLOWED_FACTS_SCHEMA = [
  'cardId',      // ID показанной карточки
  'city',        // Город
  'district',    // Район
  'neighborhood', // Район/квартал
  'priceEUR',    // Цена в евро (число)
  'rooms',       // Количество комнат (число)
  'floor',       // Этаж (число)
  'hasImage'     // Наличие изображений (boolean)
];

// 🆕 Sprint III: Role State Machine — детерминированное управление состояниями role
// Таблица допустимых переходов: fromRole -> event -> toRole
const ROLE_TRANSITIONS = [
  // Начальные переходы
  { from: 'initial_request', event: 'user_message', to: 'request_calibration' },
  { from: 'request_calibration', event: 'user_message', to: 'expectation_calibration' },
  { from: 'expectation_calibration', event: 'ui_card_rendered', to: 'show' },
  { from: 'show', event: 'user_message', to: 'post_show_calibration' },
  { from: 'post_show_calibration', event: 'ui_slider_ended', to: 'post_show_slider' },
  // Возможность вернуться к показу после калибровки
  { from: 'post_show_calibration', event: 'ui_card_rendered', to: 'show' },
  { from: 'post_show_slider', event: 'ui_card_rendered', to: 'show' }
];

// 🆕 Sprint III: централизованная функция смены role через state machine
const transitionRole = (session, event) => {
  const currentRole = session.role || 'initial_request';
  // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only) — defensive guard
  if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
    session.debugTrace = { items: [] };
  }
  
  // Ищем разрешённый переход
  const transition = ROLE_TRANSITIONS.find(
    t => t.from === currentRole && t.event === event
  );
  
  if (transition) {
    const oldRole = session.role;
    session.role = transition.to;
    console.log(`🔄 [Sprint III] Role transition: ${oldRole} --[${event}]--> ${session.role} (сессия ${session.sessionId?.slice(-8) || 'unknown'})`);
    session.debugTrace.items.push({
      type: 'role_transition',
      at: Date.now(),
      payload: { from: oldRole, to: session.role, event }
    });
    return true;
  }
  
  // Переход не разрешён — role не меняется
  console.log(`⚠️ [Sprint III] Role transition blocked: ${currentRole} --[${event}]--> (не разрешено)`);
  return false;
};

const cleanupOldSessions = () => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      sessions.delete(sessionId);
    }
  }
};
setInterval(cleanupOldSessions, 60 * 60 * 1000);

const generateSessionId = () => `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getOrCreateSession = (sessionId) => {
  if (!sessionId) sessionId = generateSessionId();
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      // 🆕 Профиль клиента для логики воронки
      clientProfile: {
        language: null,
        location: null,
        budgetMin: null,
        budgetMax: null,
        purpose: null,
        propertyType: null,
        urgency: null
      },
      // 🆕 Текущая стадия диалога
      stage: 'intro',
      // 🆕 Sprint III: server-side role (детерминированное состояние через state machine)
      role: 'initial_request',
      // 🆕 РАСШИРЕННАЯ СТРУКТУРА INSIGHTS (9 параметров)
      insights: {
        // Блок 1: Основная информация (33.3%)
        name: null,           // 10%
        operation: null,      // 12%  
        budget: null,         // 11%
        
        // Блок 2: Параметры недвижимости (33.3%)
        type: null,           // 11%
        location: null,       // 11%
        rooms: null,          // 11%
        
        // Блок 3: Детали и предпочтения (33.3%)
        area: null,           // 11%
        details: null,        // 11% (детали локации: возле парка, пересечение улиц)
        preferences: null,    // 11%
        
        progress: 0
      },
      // 🆕 Sprint II / Block A: allowedFactsSnapshot (разрешённые факты для AI)
      // Формируется только после подтверждённого показа карточки (ui_card_rendered)
      // Пока не используется ни UI, ни AI — чистое введение структуры
      allowedFactsSnapshot: {},
      // 🆕 Sprint III: handoff как системный механизм (boundary), не роль
      handoffDone: false,
      handoffAt: null,
      // 🆕 Sprint III: lead snapshot (read-only после создания при handoff)
      leadSnapshot: null,
      leadSnapshotAt: null,
      // 🆕 Sprint III: post-handoff enrichment (данные после handoff)
      postHandoffEnrichment: [],
      // 🆕 Sprint III: completion conditions (завершение диалога после handoff)
      completionDone: false,
      completionAt: null,
      completionReason: null,
      // 🆕 Sprint IV: slider context state (активность slider в UI)
      sliderContext: {
        active: false,
        updatedAt: null
      },
      // 🆕 Sprint IV: current focus card (какая карточка сейчас в фокусе UI)
      currentFocusCard: {
        cardId: null,
        updatedAt: null
      },
      // 🆕 Sprint IV: last shown card (последняя показанная карточка, подтверждённая ui_card_rendered)
      lastShown: {
        cardId: null,
        updatedAt: null
      },
      // 🆕 Sprint IV: last focus snapshot (последний подтверждённый фокус, фиксируется только при ui_focus_changed)
      lastFocusSnapshot: null,
      // 🆕 Sprint V: reference intent (фиксация факта ссылки в сообщении пользователя, без интерпретации)
      referenceIntent: null,
      // 🆕 Sprint V: reference ambiguity (фиксация факта неоднозначности reference, без разрешения)
      referenceAmbiguity: {
        isAmbiguous: false,
        reason: null,
        detectedAt: null,
        source: 'server_contract'
      },
      // 🆕 Sprint V: clarification required state (требуется уточнение из-за reference ambiguity)
      clarificationRequired: {
        isRequired: false,
        reason: null,
        detectedAt: null,
        source: 'server_contract'
      },
      // 🆕 Sprint V: single-reference binding proposal (предложение cardId из currentFocusCard, не выбор)
      singleReferenceBinding: {
        hasProposal: false,
        proposedCardId: null,
        source: 'server_contract',
        detectedAt: null,
        basis: null
      },
      // 🆕 Sprint VI / Task #1: Candidate Shortlist (server-side, observation only)
      // Инфраструктура Roadmap v2: фиксируем, какие карточки обсуждаются пользователем.
      // ВАЖНО:
      // - shortlist ≠ выбор, ≠ handoff, ≠ UX-решение
      // - append-only, без удаления и автоочистки
      // - не зависит от like / shownSet / lastShown
      // - source допустим: 'focus_proposal' | 'explicit_choice_event'
      candidateShortlist: {
        items: []
      },
      // 🆕 Sprint VI / Task #2: Explicit Choice Event (infrastructure only)
      // Фиксация факта явного выбора пользователем (речь), НЕ действие:
      // - не запускает handoff
      // - не меняет role
      // - не влияет на UX
      explicitChoiceEvent: {
        isConfirmed: false,
        cardId: null,
        detectedAt: null,
        source: 'user_message'
      },
      // 🆕 Sprint VI / Task #3: Choice Confirmation Boundary (infrastructure only)
      // Граница "выбор подтверждён" — чистый state, НЕ действие:
      // - не запускает handoff
      // - не меняет role
      // - не влияет на UX
      // - не сбрасывается автоматически
      choiceConfirmationBoundary: {
        active: false,
        chosenCardId: null,
        detectedAt: null,
        source: null // 'explicit_choice_event'
      },
      // 🆕 Sprint VI / Task #4: No-Guessing Invariant (server guard, derived state)
      // active === true только если clarificationBoundaryActive === true
      // Это инвариант целостности, не UX и не действие.
      noGuessingInvariant: {
        active: false,
        reason: null, // 'clarification_required'
        enforcedAt: null
      },
      // 🆕 Sprint VII / Task #1: Unknown UI Actions (diagnostics only)
      // Фиксация неизвестных action, пришедших от UI, без side-effects.
      unknownUiActions: {
        count: 0,
        items: []
      },
      // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
      debugTrace: {
        items: []
      },
      // 🆕 Sprint V: clarification boundary active (диагностическое поле: активна ли граница уточнения)
      clarificationBoundaryActive: false
    });
  }
  return sessions.get(sessionId);
};

const addMessageToSession = (sessionId, role, content) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.messages.push({ role, content, timestamp: Date.now() });
    session.lastActivity = Date.now();
  }
};

// ====== Подбор карточек на основе insights / текста ======
const parseBudgetEUR = (s) => {
  if (!s) return null;
  const m = String(s).replace(/[^0-9]/g, '');
  return m ? parseInt(m, 10) : null;
};

const detectCardIntent = (text = '') => {
  const t = String(text).toLowerCase();
  // учитываем формулировки: "покажи её/ее подробнее", "давай карточку", "сюда отправь"
  const isShow = /(покажи(те)?\s*(ее|её)?\s*(подробнее)?|показать\s*(ее|её)?|посмотреть\s*(ее|её)?|карточк|сюда\s*отправь|давай\s*карточку|подробн)/i.test(t);
  const isVariants = /(какие|что)\s+(есть|можно)\s+(вариант|квартир)/i.test(t)
    || /подбери(те)?|подобрать|вариант(ы)?|есть\s+вариант/i.test(t)
    || /квартир(а|ы|у)\s+(есть|бывают)/i.test(t);
  return { show: isShow, variants: isVariants };
};

// Намерение: запись на просмотр / передать менеджеру
const detectScheduleIntent = (text = '') => {
  const t = String(text).toLowerCase();
  return /(записать|записаться|просмотр(ы)?|встретить|встреч(а|у)|перезвон|связать|связаться|передать\s+менеджеру|передай\s+менеджеру)/i.test(t);
};

// 🆕 Sprint VI / Task #2: явная фиксация explicit choice по строгому whitelist (без LLM)
// Разрешённые маркеры (строгий whitelist):
// - «беру эту»
// - «выбираю эту»
// - «остановимся на этом варианте»
// - «да, эту квартиру»
// Запрещено: «нравится», «подходит», «вроде норм», «давай дальше» и т.п.
const detectExplicitChoiceMarker = (text = '') => {
  const t = String(text).toLowerCase().trim();
  const patterns = [
    /(?:^|[.!?]\s*|,\s*)беру\s+эту\b/i,
    /(?:^|[.!?]\s*|,\s*)выбираю\s+эту\b/i,
    /(?:^|[.!?]\s*|,\s*)остановимся\s+на\s+этом\s+варианте\b/i,
    /(?:^|[.!?]\s*|,\s*)да,?\s+эту\s+квартиру\b/i
  ];
  return patterns.some((re) => re.test(t));
};

const normalizeDistrict = (val) => {
  if (!val) return '';
  let s = String(val).toLowerCase().replace(/^район\s+/i, '').trim();
  const map = {
    'русафа': 'ruzafa', 'руссафа': 'ruzafa', 'ruzafa': 'ruzafa',
    'эль кармен': 'el carmen', 'el carmen': 'el carmen',
    'кабаньял': 'cabanyal', 'кабанал': 'cabanyal', 'cabanyal': 'cabanyal',
    'бенимаклет': 'benimaclet', 'benimaclet': 'benimaclet',
    'патраикс': 'patraix', 'patraix': 'patraix',
    'экстрамурс': 'extramurs', 'extramurs': 'extramurs',
    'pla del real': 'pla del real', 'пла дель реаль': 'pla del real',
    'la saïdia': 'la saïdia', 'саидия': 'la saïdia',
    'camins al grau': 'camins al grau', 'каминс': 'camins al grau',
    'poblenou': 'poblenou', 'побленоу': 'poblenou'
  };
  return map[s] || s;
};

const scoreProperty = (p, insights) => {
  let score = 0;
  // rooms
  const roomsNum = (() => {
    const m = insights.rooms && String(insights.rooms).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  })();
  if (roomsNum != null && Number(p.rooms) === roomsNum) score += 2;
  // district (insights.location хранит район)
  const insightDistrict = normalizeDistrict(insights.location);
  const propDistrict = normalizeDistrict(p.district);
  if (insightDistrict && propDistrict && propDistrict === insightDistrict) score += 3;
  // budget
  const budget = parseBudgetEUR(insights.budget);
  if (budget != null) {
    if (Number(p.priceEUR) <= budget) score += 2;
    const diff = Math.abs(Number(p.priceEUR) - budget) / (budget || 1);
    if (diff <= 0.2) score += 1; // в пределах 20%
  }
  // default city preference (Valencia)
  if (p.city && String(p.city).toLowerCase() === 'valencia') score += 1;
  return score;
};

// Нормализация строки из БД к формату карточек, совместимому с фронтом
const mapRowToProperty = (row) => {
  const images = Array.isArray(row.images)
    ? row.images
    : (typeof row.images === 'string'
        ? (() => { try { return JSON.parse(row.images); } catch { return []; } })()
        : []);
  return {
    // важный момент: используем external_id как основной id (совместимость со старым фронтом)
    id: row.external_id || String(row.id),
    city: row.location_city || null,
    district: row.location_district || null,
    neighborhood: row.location_neighborhood || null,
    priceEUR: row.price_amount != null ? Number(row.price_amount) : null,
    rooms: row.specs_rooms != null ? Number(row.specs_rooms) : null,
    floor: row.specs_floor != null ? Number(row.specs_floor) : null,
    images,
  };
};

const getAllNormalizedProperties = async () => {
  const rows = await getAllProperties();
  return rows.map(mapRowToProperty);
};

const findBestProperties = async (insights, limit = 1) => {
  const all = await getAllNormalizedProperties();
  const ranked = all
    .map((p) => ({ p, s: scoreProperty(p, insights) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ p }) => p);
  return ranked;
};

const getBaseUrl = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return host ? `${proto}://${host}` : '';
};

const formatCardForClient = (req, p) => {
  const baseUrl = getBaseUrl(req);
  const rawFirstImage = Array.isArray(p.images) && p.images.length ? p.images[0] : null;
  const image = rawFirstImage ? String(rawFirstImage).replace('https://<backend-host>', baseUrl) : null;
  return {
    id: p.id,
    // Левые поля (география)
    city: p.city ?? p?.location?.city ?? null,
    district: p.district ?? p?.location?.district ?? null,
    neighborhood: p.neighborhood ?? p?.location?.neighborhood ?? null,
    // Правые поля (основные цифры)
    price: (p.priceEUR != null ? `${p.priceEUR} €` : (p?.price?.amount != null ? `${p.price.amount} €` : null)),
    priceEUR: p.priceEUR ?? p?.price?.amount ?? null,
    rooms: p.rooms ?? p?.specs?.rooms ?? null,
    floor: p.floor ?? p?.specs?.floor ?? null,
    // Изображение
    image,
    imageUrl: image
  };
};

// Определяем язык по истории сессии (ru/en)
const detectLangFromSession = (session) => {
  try {
    const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
    const sample = lastUser?.content || '';
    if (/[А-Яа-яЁё]/.test(sample)) return 'ru';
    if (/[A-Za-z]/.test(sample)) return 'en';
  } catch {}
  return 'ru';
};

// Язык по приоритету: профиль → история
const getPrimaryLanguage = (session) => {
  const prof = session?.clientProfile?.language;
  if (prof) return String(prof).toLowerCase();
  return detectLangFromSession(session);
};

// Вариативные короткие фразы при показе карточки (в ответ модели)
const generateShowIntro = (lang) => {
  const ru = [
    'Сейчас покажу.',
    'Давайте посмотрим этот вариант.',
    'Окей, открою карточку.',
    'Покажу подходящий вариант.',
    'Хорошо, посмотрим подробнее.'
  ];
  // Временно фиксируем язык на русский; поддержку языков добавим позже
  const bank = ru;
  return bank[Math.floor(Math.random() * bank.length)];
};

// Вариативный динамический комментарий под карточкой (для /interaction)
const generateCardComment = (lang, p) => {
  // Временно фиксируем язык на русский; поддержку языков добавим позже
  const fallback = 'Как вам?';
  const ru = [
    (p) => `Как вам район: ${p.city}, ${p.district}?`,
    (p) => `Комнат: ${p.rooms} — ${p.priceEUR} €. Что думаете?`,
    (p) => `По району и цене — удачное сочетание. Как вам?`,
    (p) => `В этом бюджете выглядит здраво. Оцените, пожалуйста.`,
    (p) => `Посмотрите вариант и скажите впечатления.`
  ];
  const bank = ru;
  try {
    const pick = bank[Math.floor(Math.random() * bank.length)];
    return (typeof pick === 'function') ? (p ? pick(p) : fallback) : (pick || fallback);
  } catch {
    return fallback;
  }
};

// --------- Simple parsers for contact and time from text ---------
const parseEmailFromText = (text) => {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
};

const parsePhoneFromText = (text) => {
  // Allow +, spaces, dashes, parentheses; normalize to +digits
  const m = text.match(/\+?\s*[0-9][0-9\s()\-]{5,}/);
  if (!m) return null;
  const digits = m[0].replace(/[^0-9+]/g, '');
  const normalized = `+${digits.replace(/^\++/,'')}`;
  return normalized.length >= 7 ? normalized : null;
};

const parseTimeWindowFromText = (text) => {
  try {
    const lower = text.toLowerCase();
    const tz = 'Europe/Madrid';
    const now = new Date();
    const todayStr = new Date(now).toLocaleString('sv-SE', { timeZone: tz }).slice(0,10);
    const tomorrow = new Date(now.getTime() + 24*60*60*1000);
    const tomorrowStr = tomorrow.toLocaleString('sv-SE', { timeZone: tz }).slice(0,10);

    const isToday = /(сегодня|today)/i.test(lower);
    const isTomorrow = /(завтра|tomorrow)/i.test(lower);

    // HH or HH:MM
    const timeSingle = lower.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
    // ranges like 17–19 or 17-19
    const timeRange = lower.match(/\b(\d{1,2})\s*[–\-]\s*(\d{1,2})\b/);

    let date = null; let from = null; let to = null;
    if (isToday) date = todayStr; else if (isTomorrow) date = tomorrowStr;
    if (timeRange) { from = `${timeRange[1].padStart(2,'0')}:00`; to = `${timeRange[2].padStart(2,'0')}:00`; }
    else if (timeSingle) { from = `${timeSingle[1].padStart(2,'0')}:${(timeSingle[2]||'00')}`; to = null; }

    if (date && (from || to)) return { date, from, to, timezone: tz };
    return null;
  } catch { return null; }
};

// 🆕 Sprint III: добавление записи в post-handoff enrichment
const addPostHandoffEnrichment = (session, source, content, meta = {}) => {
  if (!session || !session.handoffDone) return;
  
  if (!Array.isArray(session.postHandoffEnrichment)) {
    session.postHandoffEnrichment = [];
  }
  
  session.postHandoffEnrichment.push({
    at: Date.now(),
    source: source,
    content: content,
    meta: meta
  });
  
  console.log(`📝 [Sprint III] Post-handoff enrichment добавлен (source: ${source}, сессия ${session.sessionId?.slice(-8) || 'unknown'})`);
};

// 🧠 Улучшенная функция извлечения insights (9 параметров)
const updateInsights = (sessionId, newMessage) => {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  // 🆕 Sprint III: после handoff не обновляем insights, только логируем в enrichment
  if (session.handoffDone) {
    addPostHandoffEnrichment(session, 'user_message', newMessage, {
      role: session.role,
      stage: session.stage
    });
    return;
  }

  const { insights } = session;
  const text = newMessage.toLowerCase();
  
  console.log(`🧠 Анализирую сообщение для insights: "${newMessage}"`);

  // 1. 👤 Извлечение имени (более гибкие паттерны)
  if (!insights.name) {
    const namePatterns = [
      /меня зовут\s+([а-яё]+)/i,           // "меня зовут Георгий"
      /я\s+([а-яё]+)/i,                     // "я Георгий" 
      /имя\s+([а-яё]+)/i,                   // "имя Георгий"
      /зовите\s+меня\s+([а-яё]+)/i,         // "зовите меня Георгий"
      /это\s+([а-яё]+)/i,                   // "это Георгий"
      /меня\s+(\w+)/i                       // "меня Георгий"
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1].length > 2) { // имя должно быть больше 2 символов
        insights.name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        console.log(`✅ Найдено имя: ${insights.name}`);
        break;
      }
    }
  }

  // 2. 🏠 Тип недвижимости (учитываем склонения)
  if (!insights.type) {
    const propertyPatterns = [
      /(квартир[уыаеой]|квартир)/i,        // квартиру, квартиры, квартира, квартире
      /(дом[аеыой]?|дом)/i,                // дом, дома, доме
      /(апартамент[ыаеойв]*)/i,            // апартаменты, апартамент
      /(комнат[уыаеой]|комнат)/i,          // комнату, комнаты, комната
      /(студи[юяеий]*)/i,                  // студия, студию
      /(пентхаус[аеы]*)/i,                 // пентхаус, пентхауса
      /(таунхаус[аеы]*)/i                  // таунхаус, таунхауса
    ];

    for (const pattern of propertyPatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[1].startsWith('квартир')) insights.type = 'квартира';
        else if (match[1].startsWith('дом')) insights.type = 'дом'; 
        else if (match[1].startsWith('апартамент')) insights.type = 'апартаменты';
        else if (match[1].startsWith('комнат')) insights.type = 'комната';
        else if (match[1].startsWith('студи')) insights.type = 'студия';
        else if (match[1].startsWith('пентхаус')) insights.type = 'пентхаус';
        else if (match[1].startsWith('таунхаус')) insights.type = 'таунхаус';
        
        console.log(`✅ Найден тип недвижимости: ${insights.type}`);
        break;
      }
    }
  }

  // 3. 💰 Тип операции (покупка/аренда)
  if (!insights.operation) {
    const operationPatterns = [
      // Покупка
      /(купить|покуп[каеи]|куплю|приобрести|приобретение)/i,
      /(покупк[аеуи]|в\s*покупку)/i,
      /(купил|хочу\s+купить|планирую\s+купить)/i,
      /(инвестиц|инвестировать)/i,
      
      // Аренда  
      /(снять|аренд[аеуио]*|арендовать|сдать)/i,
      /(в\s*аренду|на\s*аренду|под\s*аренду)/i,
      /(съем|снимать|найм)/i
    ];

    for (const pattern of operationPatterns) {
      const match = text.match(pattern);
      if (match) {
        const matched = match[1].toLowerCase();
        if (matched.includes('купи') || matched.includes('покуп') || matched.includes('приобр') || matched.includes('инвест')) {
          insights.operation = 'покупка';
        } else if (matched.includes('снять') || matched.includes('аренд') || matched.includes('съем') || matched.includes('найм')) {
          insights.operation = 'аренда';
        }
        console.log(`✅ Найдена операция: ${insights.operation}`);
        break;
      }
    }
  }

  // 4. 💵 Бюджет (более гибкие паттерны для чисел)
  if (!insights.budget) {
    const budgetPatterns = [
      // Точные числа: "300000 евро", "300 тысяч евро"
      /(\d+[\d\s]*)\s*(тысяч?|тыс\.?)\s*(евро|€|euro)/i,
      /(\d+[\d\s]*)\s*(евро|€|euro)/i,
      
      // Диапазоны: "от 200 до 400 тысяч", "200-400к"
      /(от\s*)?(\d+)[\s-]*(\d+)?\s*(тысяч?|тыс\.?|к)\s*(евро|€|euro)?/i,
      
      // Около/примерно: "около 300к", "примерно 250 тысяч"
      /(около|примерно|где-?то|приблизительно)\s*(\d+[\d\s]*)\s*(тысяч?|тыс\.?|к)?\s*(евро|€|euro)?/i,
      
      // До: "до 500 тысяч"
      /(до|максимум|не\s*больше)\s*(\d+[\d\s]*)\s*(тысяч?|тыс\.?|к)\s*(евро|€|euro)?/i
    ];

    for (const pattern of budgetPatterns) {
      const match = text.match(pattern);
      if (match) {
        let amount = '';
        let numberIndex = 1;
        
        // Находим индекс с числом
        for (let i = 1; i < match.length; i++) {
          if (match[i] && /\d/.test(match[i])) {
            numberIndex = i;
            break;
          }
        }
        
        let number = match[numberIndex];
        
        // Убираем пробелы из числа
        if (number) {
          number = number.replace(/\s/g, '');
          
          // Если есть "тысяч" - умножаем на 1000
          if (match[0].includes('тысяч') || match[0].includes('тыс') || match[0].includes('к')) {
            amount = `${number}000`;
          } else {
            amount = number;
          }
          
          insights.budget = `${amount} €`;
          console.log(`✅ Найден бюджет: ${insights.budget}`);
          break;
        }
      }
    }
  }

  // 5. 📍 Район/локация (расширенный список районов Валенсии)
  if (!insights.location) {
    const locationPatterns = [
      // Основные районы Валенсии
      /(центр[ае]?|исторический\s*центр|старый\s*город)/i,
      /(русаф[аеы]?|russafa)/i,
      /(алавес|alavés)/i,
      /(кабаньял|cabanyal|кабанал)/i,
      /(бенимаклет|benimaclet)/i,
      /(патраикс|patraix)/i,
      /(camins|каминс)/i,
      /(побленоу|poblats\s*del\s*sud)/i,
      /(экстрамурс|extramurs)/i,
      /(пла\s*дель\s*реаль|pla\s*del\s*real)/i,
      /(ла\s*сайдиа|la\s*saïdia)/i,
      /(морской|побережье|у\s*моря|пляж)/i,
      
      // Общие указания
      /(район[еа]?\s*(\w+))/i,
      /(зон[аеу]\s*(\w+))/i,
      /(недалеко\s*от\s*(\w+))/i
    ];

    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match) {
        const location = match[1].toLowerCase();
        
        if (location.includes('центр')) insights.location = 'Центр';
        else if (location.includes('русаф')) insights.location = 'Русафа';
        else if (location.includes('алавес')) insights.location = 'Алавес';
        else if (location.includes('кабаньял') || location.includes('кабанал')) insights.location = 'Кабаньял';
        else if (location.includes('бенимаклет')) insights.location = 'Бенимаклет';
        else if (location.includes('патраикс')) insights.location = 'Патраикс';
        else if (location.includes('camins') || location.includes('каминс')) insights.location = 'Camins al Grau';
        else if (location.includes('побленоу')) insights.location = 'Побленоу';
        else if (location.includes('экстрамурс')) insights.location = 'Экстрамурс';
        else if (location.includes('морской') || location.includes('пляж')) insights.location = 'У моря';
        else if (match[2]) insights.location = match[2]; // район + название
        
        console.log(`✅ Найдена локация: ${insights.location}`);
        break;
      }
    }
  }

  // 🆕 6. 🏠 Количество комнат
  if (!insights.rooms) {
    const roomPatterns = [
      /(\d+)[\s-]*(комнат[ауыйе]*|спален|bedroom)/i,        // "3 комнаты", "2 спальни"
      /(одн[ауо][\s-]*комнат|однушк|1[\s-]*комнат)/i,       // "однокомнатная", "однушка"
      /(двух[\s-]*комнат|двушк|2[\s-]*комнат)/i,            // "двухкомнатная", "двушка"
      /(трех[\s-]*комнат|трешк|3[\s-]*комнат)/i,            // "трехкомнатная", "трешка"
      /(четырех[\s-]*комнат|4[\s-]*комнат)/i,               // "четырехкомнатная"
      /(студи[юя]|studio)/i                                 // "студия"
    ];

    for (const pattern of roomPatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[0].includes('студи')) {
          insights.rooms = 'студия';
        } else if (match[0].includes('одн') || match[0].includes('1')) {
          insights.rooms = '1 комната';
        } else if (match[0].includes('двух') || match[0].includes('двушк') || match[0].includes('2')) {
          insights.rooms = '2 комнаты';
        } else if (match[0].includes('трех') || match[0].includes('трешк') || match[0].includes('3')) {
          insights.rooms = '3 комнаты';
        } else if (match[0].includes('четырех') || match[0].includes('4')) {
          insights.rooms = '4 комнаты';
        } else if (match[1] && /\d/.test(match[1])) {
          const num = match[1];
          insights.rooms = `${num} ${num == 1 ? 'комната' : 'комнаты'}`;
        }
        
        console.log(`✅ Найдено количество комнат: ${insights.rooms}`);
        break;
      }
    }
  }

  // 🆕 7. 📐 Площадь
  if (!insights.area) {
    const areaPatterns = [
      /(\d+)[\s-]*(кв\.?\s*м\.?|м2|квадрат|метр)/i,           // "100 кв.м", "80м2"
      /площад[ьи]?\s*(\d+)/i,                                // "площадь 120"
      /(\d+)[\s-]*квадрат/i,                                 // "90 квадратов"
      /(от|около|примерно)\s*(\d+)[\s-]*(кв\.?\s*м\.?|м2)/i  // "от 80 кв.м"
    ];

    for (const pattern of areaPatterns) {
      const match = text.match(pattern);
      if (match) {
        let area = '';
        // Находим число в любой позиции
        for (let i = 1; i < match.length; i++) {
          if (match[i] && /\d/.test(match[i])) {
            area = match[i];
            break;
          }
        }
        
        if (area) {
          insights.area = `${area} м²`;
          console.log(`✅ Найдена площадь: ${insights.area}`);
          break;
        }
      }
    }
  }

  // 🆕 8. 📍 Детали локации
  if (!insights.details) {
    const detailPatterns = [
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(парк[аеуи]*|сквер[аеуи]*|зелен[иоы]*)/i,    // "возле парка"
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(метро|станци[иеяй]*)/i,                      // "рядом с метро"
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(школ[ыаеий]*|детск[аеойи]*)/i,               // "около школы"
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(магазин[аеовы]*|торгов[аеоый]*)/i,           // "рядом с магазинами"
      /(центральн[аяое]*|тихий|спокойн[ыйое]*|шумн[ыйое]*)/i,                               // "тихий", "центральная"
      /(пешком\s*до|5\s*минут|10\s*минут)/i,                                                // "пешком до центра"
      /(перекрест[окек]*|пересечени[ея]*|угол[у]*)\s*улиц/i                                  // "пересечение улиц"
    ];

    for (const pattern of detailPatterns) {
      const match = text.match(pattern);
      if (match) {
        let detail = match[0];
        
        // Нормализуем детали
        if (detail.includes('парк') || detail.includes('зелен')) {
          insights.details = 'возле парка';
        } else if (detail.includes('метро') || detail.includes('станци')) {
          insights.details = 'рядом с метро';
        } else if (detail.includes('школ') || detail.includes('детск')) {
          insights.details = 'около школы';
        } else if (detail.includes('магазин') || detail.includes('торгов')) {
          insights.details = 'рядом с магазинами';
        } else if (detail.includes('тихий') || detail.includes('спокойн')) {
          insights.details = 'тихий район';
        } else if (detail.includes('центральн')) {
          insights.details = 'центральное расположение';
        } else if (detail.includes('пешком') || detail.includes('минут')) {
          insights.details = 'удобная транспортная доступность';
        } else if (detail.includes('перекрест') || detail.includes('пересечени') || detail.includes('угол')) {
          insights.details = 'пересечение улиц';
        } else {
          insights.details = match[0];
        }
        
        console.log(`✅ Найдены детали локации: ${insights.details}`);
        break;
      }
    }
  }

  // 🆕 9. ⭐ Предпочтения
  if (!insights.preferences) {
    const preferencePatterns = [
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(балкон|лоджи[яй]*)/i,    // "важен балкон"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(лифт|подъемник)/i,        // "нужен лифт"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(паркинг|гараж|парковк)/i, // "желательно парковка"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(ремонт|обновлен)/i,        // "хочу с ремонтом"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(мебел[ьи]*)/i,             // "предпочитаю с мебелью"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(кондиционер|климат)/i,     // "нужен кондиционер"
      /(без\s*посредник|напряму[ую]*|от\s*собственник)/i,                                      // "без посредников"
      /(срочн[оы]*|быстр[оы]*|как\s*можно\s*скорее)/i,                                         // "срочно"
      /(в\s*рассрочку|ипотек[аеуи]*|кредит)/i                                                  // "в ипотеку"
    ];

    for (const pattern of preferencePatterns) {
      const match = text.match(pattern);
      if (match) {
        let preference = match[0].toLowerCase();
        
        // Нормализуем предпочтения
        if (preference.includes('балкон') || preference.includes('лоджи')) {
          insights.preferences = 'с балконом';
        } else if (preference.includes('лифт')) {
          insights.preferences = 'с лифтом';
        } else if (preference.includes('паркинг') || preference.includes('гараж') || preference.includes('парковк')) {
          insights.preferences = 'с парковкой';
        } else if (preference.includes('ремонт') || preference.includes('обновлен')) {
          insights.preferences = 'с ремонтом';
        } else if (preference.includes('мебел')) {
          insights.preferences = 'с мебелью';
        } else if (preference.includes('кондиционер') || preference.includes('климат')) {
          insights.preferences = 'с кондиционером';
        } else if (preference.includes('без') && preference.includes('посредник')) {
          insights.preferences = 'без посредников';
        } else if (preference.includes('срочн') || preference.includes('быстр') || preference.includes('скорее')) {
          insights.preferences = 'срочный поиск';
        } else if (preference.includes('рассрочку') || preference.includes('ипотек') || preference.includes('кредит')) {
          insights.preferences = 'ипотека/рассрочка';
        } else {
          insights.preferences = match[0];
        }
        
        console.log(`✅ Найдены предпочтения: ${insights.preferences}`);
        break;
      }
    }
  }

  // 📊 Обновляем прогресс по системе весов фронтенда
  const weights = {
    // Блок 1: Основная информация (33.3%)
    name: 11,
    operation: 11,
    budget: 11,
    
    // Блок 2: Параметры недвижимости (33.3%)
    type: 11,
    location: 11,
    rooms: 11,
    
    // Блок 3: Детали и предпочтения (33.3%)
    area: 11,
    details: 11,
    preferences: 11
  };
  
  let totalProgress = 0;
  let filledFields = 0;
  
  for (const [field, weight] of Object.entries(weights)) {
    if (insights[field] && insights[field].trim()) {
      totalProgress += weight;
      filledFields++;
    }
  }
  
  insights.progress = Math.min(totalProgress, 99); // максимум 99%
  
  console.log(`📊 Прогресс понимания: ${insights.progress}% (${filledFields}/9 полей заполнено)`);
  console.log(`🔍 Текущие insights:`, insights);
};

// 🤖 [DEPRECATED] GPT анализатор для извлечения insights (9 параметров)
// Основной механизм анализа теперь через META-JSON в ответе модели внутри основного диалога.
const analyzeContextWithGPT = async (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    console.log(`🤖 Запускаю GPT анализ контекста для сессии ${sessionId.slice(-8)}`);
    
    // Подготавливаем историю диалога для анализа
    const conversationHistory = session.messages
      .filter(msg => msg.role !== 'system')
      .map(msg => `${msg.role === 'user' ? 'Клиент' : 'Джон'}: ${msg.content}`)
      .join('\n');

    const analysisPrompt = `Проанализируй диалог с клиентом по недвижимости и извлеки ключевую информацию.

ДИАЛОГ:
${conversationHistory}

ЗАДАЧА: Найди и извлеки следующую информацию о клиенте (9 параметров):

БЛОК 1 - ОСНОВНАЯ ИНФОРМАЦИЯ:
1. ИМЯ КЛИЕНТА - как его зовут (учти возможные ошибки транскрипции)
2. ТИП ОПЕРАЦИИ - покупка или аренда  
3. БЮДЖЕТ - сколько готов потратить (в евро, приведи к числу)

БЛОК 2 - ПАРАМЕТРЫ НЕДВИЖИМОСТИ:
4. ТИП НЕДВИЖИМОСТИ - что ищет (квартира, дом, студия, апартаменты, комната, пентхаус)
5. ЛОКАЦИЯ - где ищет (район, город, особенности расположения)
6. КОЛИЧЕСТВО КОМНАТ - сколько комнат нужно (1 комната, 2 комнаты, студия, etc.)

БЛОК 3 - ДЕТАЛИ И ПРЕДПОЧТЕНИЯ:
7. ПЛОЩАДЬ - какая площадь нужна (в м²)
8. ДЕТАЛИ ЛОКАЦИИ - особенности расположения (возле парка, рядом с метро, тихий район, пересечение улиц)
9. ПРЕДПОЧТЕНИЯ - дополнительные требования (с балконом, с парковкой, с ремонтом, срочно, etc.)

ВАЖНО:
- Исправляй ошибки транскрипции (Аленсия → Валенсия, Русфа → Русафа)
- Учитывай контекст и подтекст
- Если информации нет - укажи null
- Бюджет приводи к формату "число €" (например: "300000 €")
- Комнаты в формате "число комнаты" или "студия"
- Площадь в формате "число м²"

ОТВЕТ СТРОГО В JSON:
{
  "name": "имя или null",
  "operation": "покупка/аренда или null",
  "budget": "сумма € или null",
  "type": "тип недвижимости или null", 
  "location": "локация или null",
  "rooms": "количество комнат или null",
  "area": "площадь м² или null",
  "details": "детали локации или null",
  "preferences": "предпочтения или null"
}`;

    // Делаем запрос к GPT для анализа
    const analysisResponse = await callOpenAIWithRetry(() => 
      openai.chat.completions.create({
        messages: [
          { role: 'system', content: 'Ты эксперт по анализу диалогов с клиентами недвижимости. Отвечай только валидным JSON.' },
          { role: 'user', content: analysisPrompt }
        ],
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 500
      }), 2, 'GPT-Analysis'
    );

    const analysisText = analysisResponse.choices[0].message.content.trim();
    console.log(`🔍 GPT анализ результат: ${analysisText}`);

    // Парсим JSON ответ
    let extractedData;
    try {
      // Убираем возможные markdown блоки
      const cleanJson = analysisText.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга JSON от GPT:', parseError.message);
      return;
    }

    // 🆕 Sprint III: после handoff не обновляем insights, только логируем в enrichment
    if (session.handoffDone) {
      addPostHandoffEnrichment(session, 'gpt_analysis', JSON.stringify(extractedData), {
        role: session.role,
        stage: session.stage
      });
      return;
    }
    
    // Обновляем insights только если GPT нашел что-то новое
    let updated = false;
    const oldInsights = { ...session.insights };

    // Проверяем все 9 параметров
    const fieldsToCheck = ['name', 'operation', 'budget', 'type', 'location', 'rooms', 'area', 'details', 'preferences'];
    
    for (const field of fieldsToCheck) {
      if (extractedData[field] && !session.insights[field]) {
        session.insights[field] = extractedData[field];
        updated = true;
        console.log(`✅ GPT обновил ${field}: ${extractedData[field]}`);
      }
      
      // Если GPT нашел исправления для существующих данных
      if (extractedData[field] && session.insights[field] && extractedData[field] !== session.insights[field]) {
        console.log(`🔄 GPT предлагает исправить ${field}: ${session.insights[field]} → ${extractedData[field]}`);
        session.insights[field] = extractedData[field];
        updated = true;
      }
    }

    if (updated) {
      // Пересчитываем прогресс по системе весов фронтенда
      const weights = {
        name: 11, operation: 11, budget: 11,
        type: 11, location: 11, rooms: 11,
        area: 11, details: 11, preferences: 11
      };
      
      let totalProgress = 0;
      let filledFields = 0;
      
      for (const [field, weight] of Object.entries(weights)) {
        if (session.insights[field] && session.insights[field].trim()) {
          totalProgress += weight;
          filledFields++;
        }
      }
      
      session.insights.progress = Math.min(totalProgress, 99);
      
      console.log(`🚀 GPT анализ завершен. Прогресс: ${session.insights.progress}% (${filledFields}/9 полей)`);
      console.log(`📊 Обновленные insights:`, session.insights);
    } else {
      console.log(`ℹ️ GPT не нашел новой информации для обновления`);
    }

    // Логируем использование токенов
    console.log(`💰 GPT анализ использовал ${analysisResponse.usage.total_tokens} токенов`);

  } catch (error) {
    console.error(`❌ Ошибка GPT анализа для сессии ${sessionId.slice(-8)}:`, error.message);
  }
};

// 📊 [DEPRECATED] Проверяем, нужно ли запустить GPT анализ раз в N сообщений
// Основной механизм анализа теперь через META-JSON; этот триггер оставлен для совместимости и может быть отключён ENV.
const checkForGPTAnalysis = async (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Считаем только пользовательские сообщения (не системные)
  const userMessages = session.messages.filter(msg => msg.role === 'user');
  
  // Каждые 5 пользовательских сообщений запускаем GPT анализ
  if (userMessages.length > 0 && userMessages.length % 5 === 0) {
    console.log(`🎯 Достигнуто ${userMessages.length} сообщений - запускаю GPT анализ`);
    await analyzeContextWithGPT(sessionId);
  }
};

// 🔄 Функция retry для OpenAI API
const callOpenAIWithRetry = async (apiCall, maxRetries = 2, operation = 'OpenAI') => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 ${operation} попытка ${attempt}/${maxRetries}`);
      const result = await apiCall();
      if (attempt > 1) {
        console.log(`✅ ${operation} успешно выполнен с ${attempt} попытки`);
      }
      return result;
    } catch (error) {
      console.log(`❌ ${operation} ошибка (попытка ${attempt}/${maxRetries}):`, error.message);
      
      // Если это последняя попытка - пробрасываем ошибку дальше
      if (attempt === maxRetries) {
        console.error(`🚨 ${operation} окончательно провалился после ${maxRetries} попыток`);
        throw error;
      }
      
      // Определяем, стоит ли повторять запрос
      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        console.log(`⚠️ ${operation} ошибка не подлежит повтору:`, error.message);
        throw error;
      }
      
      // Экспоненциальная задержка: 1с, 2с, 4с...
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.log(`⏳ Ожидание ${delay}мс перед следующей попыткой...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// 🔍 Определяем, можно ли повторить запрос при данной ошибке
const isRetryableError = (error) => {
  // Коды ошибок, при которых стоит повторить запрос
  const retryableCodes = [
    'ECONNRESET',     // Соединение сброшено
    'ENOTFOUND',      // DNS проблемы
    'ECONNREFUSED',   // Соединение отклонено
    'ETIMEDOUT',      // Таймаут
    'EAI_AGAIN'       // DNS временно недоступен
  ];
  
  // HTTP статусы, при которых стоит повторить
  const retryableStatuses = [500, 502, 503, 504, 429];
  
  // Проверяем код ошибки
  if (error.code && retryableCodes.includes(error.code)) {
    return true;
  }
  
  // Проверяем HTTP статус
  if (error.status && retryableStatuses.includes(error.status)) {
    return true;
  }
  
  // Проверяем сообщение об ошибке
  const errorMessage = error.message?.toLowerCase() || '';
  const retryableMessages = [
    'timeout',
    'network error',
    'connection',
    'rate limit',
    'server error',
    'service unavailable'
  ];
  
  return retryableMessages.some(msg => errorMessage.includes(msg));
};

// ====== Вспомогательные функции профиля/стадий/META ======
const determineStage = (clientProfile, currentStage, messageHistory) => {
  try {
    const nonSystemCount = Array.isArray(messageHistory)
      ? messageHistory.filter(m => m && m.role !== 'system').length
      : 0;
    if (nonSystemCount <= 1) return 'intro';
    const missingKey =
      !clientProfile?.location ||
      !(clientProfile?.budgetMin || clientProfile?.budgetMax) ||
      !clientProfile?.purpose;
    if (missingKey) return 'qualification';
    return 'matching_closing';
  } catch {
    return currentStage || 'intro';
  }
};

const mergeClientProfile = (current, delta) => {
  const result = { ...(current || {}) };
  if (delta && typeof delta === 'object') {
    for (const [key, value] of Object.entries(delta)) {
      if (value !== undefined && value !== null) {
        result[key] = value;
      }
    }
  }
  return result;
};

const normalizeNumber = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

const formatBudgetFromRange = (min, max) => {
  const minNum = normalizeNumber(min);
  const maxNum = normalizeNumber(max);
  if (minNum && maxNum) return `${minNum}–${maxNum} €`;
  if (!minNum && maxNum) return `до ${maxNum} €`;
  if (minNum && !maxNum) return `от ${minNum} €`;
  return null;
};

const mapPurposeToOperationRu = (purpose) => {
  if (!purpose) return null;
  const s = String(purpose).toLowerCase();
  if (/(buy|покуп|купить|purchase|invest|инвест)/i.test(s)) return 'покупка';
  if (/(rent|аренд|снять|lease)/i.test(s)) return 'аренда';
  return null;
};

const mapClientProfileToInsights = (clientProfile, insights) => {
  if (!clientProfile || !insights) return;
  // Бюджет
  const budgetStr = formatBudgetFromRange(clientProfile.budgetMin, clientProfile.budgetMax);
  if (budgetStr) insights.budget = budgetStr;
  // Локация
  if (clientProfile.location) insights.location = clientProfile.location;
  // Тип
  if (clientProfile.propertyType) insights.type = clientProfile.propertyType;
  // Операция
  const op = mapPurposeToOperationRu(clientProfile.purpose);
  if (op) insights.operation = op;
  // Срочность → предпочтения
  if (clientProfile.urgency && /сроч/i.test(String(clientProfile.urgency))) {
    insights.preferences = 'срочный поиск';
  }
  // Пересчёт прогресса
  const weights = {
    name: 11,
    operation: 11,
    budget: 11,
    type: 11,
    location: 11,
    rooms: 11,
    area: 11,
    details: 11,
    preferences: 11
  };
  let totalProgress = 0;
  let filledFields = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const val = insights[field];
    if (val != null && String(val).trim()) {
      totalProgress += weight;
      filledFields++;
    }
  }
  insights.progress = Math.min(totalProgress, 99);
};

// 🆕 Sprint V: детекция reference в тексте пользователя (без интерпретации)
const detectReferenceIntent = (text) => {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  // Нормализация (без библиотек):
  // - toLowerCase + trim
  // - ё→е
  // - пунктуацию/символы → в пробелы
  // - схлопнуть повторные пробелы
  // - сохранить буквы/цифры/пробелы
  const normalized = String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // ВАЖНО: порядок строго multi → single → unknown → null
  // (чтобы "эти варианты" не улетали в single из-за "эт"/"et")
  
  // Multi patterns (RU + транслит)
  const multiPatterns = [
    /\bвот эти\b/,
    /\bэти варианты\b/,
    /\bэти квартиры\b/,
    /\bэти\b/,
    /\bоба\b/,
    /\bобе\b/,
    /\bнесколько\b/,
    // translit
    /\bvot eti\b/,
    /\beti\b/
  ];
  
  for (const pattern of multiPatterns) {
    if (pattern.test(normalized)) {
      return {
        type: 'multi',
        detectedAt: Date.now(),
        source: 'user_message'
      };
    }
  }
  
  // Single patterns (RU + транслит + короткие обрезки как отдельный токен)
  const singlePatterns = [
    /\bвот эта\b/,
    /\bвот это\b/,
    /\bи эта\b/,
    /\bэто\b/,
    /\bэта квартира\b/,
    /\bэтот вариант\b/,
    /\bвот та\b/,
    /\bэта\b/,
    // translit
    /\bvot eta\b/,
    /\bvot eto\b/,
    /\beta\b/,
    /\beto\b/
  ];
  
  for (const pattern of singlePatterns) {
    if (pattern.test(normalized)) {
      return {
        type: 'single',
        detectedAt: Date.now(),
        source: 'user_message'
      };
    }
  }
  
  // Unknown markers (есть указатели, но нельзя уверенно классифицировать)
  const unknownMarkers = [
    /\bтот вариант\b/,
    /\bтот самый\b/,
    /\bтот\b/,
    /\bтакая\b/
  ];
  
  const hasUnknownMarker = unknownMarkers.some(pattern => pattern.test(normalized));
  if (hasUnknownMarker) {
    return {
      type: 'unknown',
      detectedAt: Date.now(),
      source: 'user_message'
    };
  }
  
  return null;
};

const extractAssistantAndMeta = (fullText) => {
  try {
    const marker = '---META---';
    const idx = fullText.indexOf(marker);
    if (idx === -1) {
      return { assistantText: fullText, meta: null };
    }
    const assistantText = fullText.slice(0, idx).trim();
    let jsonPart = fullText.slice(idx + marker.length).trim();
    // Срезаем возможные бэктики
    jsonPart = jsonPart.replace(/```json\s*|\s*```/g, '').trim();
    // Защитимся от слишком длинного хвоста
    if (jsonPart.length > 5000) jsonPart = jsonPart.slice(0, 5000);
    let parsed = null;
    try {
      parsed = JSON.parse(jsonPart);
    } catch {
      parsed = null;
    }
    return { assistantText, meta: parsed };
  } catch {
    return { assistantText: fullText, meta: null };
  }
};

const transcribeAndRespond = async (req, res) => {
  const startTime = Date.now();
  let sessionId = null;
  
  // Извлекаем IP и User-Agent в начале функции, чтобы они были доступны в блоке catch
  const userIp = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  try {
    if (!req.file && !req.body.text) {
      return res.status(400).json({ error: 'Не найден аудиофайл или текст' });
    }

    sessionId = req.body.sessionId || generateSessionId();
    const session = getOrCreateSession(sessionId);
    const inputTypeForLog = req.file ? 'audio' : 'text'; // для логирования (английский)
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only) — defensive guard
    if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
      session.debugTrace = { items: [] };
    }

    let transcription = '';
    let transcriptionTime = 0;

    if (req.file) {
      const audioFile = new File([req.file.buffer], req.file.originalname, {
        type: req.file.mimetype
      });

      const transcriptionStart = Date.now();
      
      // 🔄 Используем retry для Whisper API
      const whisperResponse = await callOpenAIWithRetry(() => 
        openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
          language: 'ru',
          response_format: 'text'
        }), 2, 'Whisper'
      );
      
      transcriptionTime = Date.now() - transcriptionStart;
      transcription = whisperResponse.trim();
    } else {
      transcription = req.body.text.trim();
    }

    addMessageToSession(sessionId, 'user', transcription);
    updateInsights(sessionId, transcription);
    
    // 🆕 Sprint V: детекция reference intent в сообщении пользователя (без интерпретации)
    session.referenceIntent = detectReferenceIntent(transcription);
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
    if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
      session.debugTrace = { items: [] };
    }
    session.debugTrace.items.push({
      type: 'reference_detected',
      at: Date.now(),
      payload: { referenceType: session.referenceIntent?.type || null }
    });
    
    // 🆕 Sprint V: детекция ambiguity для reference (детерминированное правило, без интерпретации)
    if (!session.referenceAmbiguity) {
      session.referenceAmbiguity = {
        isAmbiguous: false,
        reason: null,
        detectedAt: null,
        source: 'server_contract'
      };
    }
    
    if (session.referenceIntent === null) {
      // Reference не найден → неоднозначности нет
      session.referenceAmbiguity.isAmbiguous = false;
      session.referenceAmbiguity.reason = null;
      session.referenceAmbiguity.detectedAt = null;
    } else if (session.referenceIntent.type === 'multi') {
      // Multi reference → неоднозначен
      session.referenceAmbiguity.isAmbiguous = true;
      session.referenceAmbiguity.reason = 'multi_reference';
      session.referenceAmbiguity.detectedAt = Date.now();
    } else if (session.referenceIntent.type === 'unknown') {
      // Unknown reference → неоднозначен
      session.referenceAmbiguity.isAmbiguous = true;
      session.referenceAmbiguity.reason = 'unknown_reference';
      session.referenceAmbiguity.detectedAt = Date.now();
    } else if (session.referenceIntent.type === 'single') {
      // Single reference → не неоднозначен (но объект всё равно не выбран)
      session.referenceAmbiguity.isAmbiguous = false;
      session.referenceAmbiguity.reason = null;
      session.referenceAmbiguity.detectedAt = null;
    }
    
    // 🆕 Sprint V: установка clarificationRequired на основе referenceAmbiguity (детерминированное правило)
    if (!session.clarificationRequired) {
      session.clarificationRequired = {
        isRequired: false,
        reason: null,
        detectedAt: null,
        source: 'server_contract'
      };
    }
    
    if (session.referenceAmbiguity.isAmbiguous === true) {
      // Reference неоднозначен → требуется уточнение
      session.clarificationRequired.isRequired = true;
      session.clarificationRequired.reason = session.referenceAmbiguity.reason;
      session.clarificationRequired.detectedAt = Date.now();
    } else {
      // Reference не неоднозначен → уточнение не требуется
      session.clarificationRequired.isRequired = false;
      session.clarificationRequired.reason = null;
      session.clarificationRequired.detectedAt = null;
    }
    
    // 🆕 Sprint V: single-reference binding proposal (предложение cardId из currentFocusCard, только если условия выполнены)
    if (!session.singleReferenceBinding) {
      session.singleReferenceBinding = {
        hasProposal: false,
        proposedCardId: null,
        source: 'server_contract',
        detectedAt: null,
        basis: null
      };
    }
    
    // Правило: proposal только если single reference, не требуется clarification, и есть currentFocusCard
    if (session.referenceIntent?.type === 'single' && 
        session.clarificationRequired.isRequired === false &&
        session.currentFocusCard?.cardId) {
      session.singleReferenceBinding.hasProposal = true;
      session.singleReferenceBinding.proposedCardId = session.currentFocusCard.cardId;
      session.singleReferenceBinding.basis = 'currentFocusCard';
      session.singleReferenceBinding.detectedAt = Date.now();
    } else {
      // Условия не выполнены → proposal отсутствует
      session.singleReferenceBinding.hasProposal = false;
      session.singleReferenceBinding.proposedCardId = null;
      session.singleReferenceBinding.basis = null;
      session.singleReferenceBinding.detectedAt = null;
    }
    
    // 🆕 Sprint V: clarification boundary active (диагностическое поле: активна ли граница уточнения)
    // Если clarificationRequired.isRequired === true, система находится в состоянии clarification_pending
    // и не имеет права использовать proposal / binding / продвигать сценарий
    const prevClarificationBoundaryActive = session.clarificationBoundaryActive === true;
    session.clarificationBoundaryActive = session.clarificationRequired.isRequired === true;
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
    if (prevClarificationBoundaryActive !== true && session.clarificationBoundaryActive === true) {
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
      session.debugTrace.items.push({
        type: 'clarification_boundary',
        at: Date.now(),
        payload: { reason: session.clarificationRequired?.reason || null }
      });
    }

    // 🆕 Sprint VI / Task #4: No-Guessing Invariant (server guard, derived state + enforcement)
    // Правило: пока clarificationBoundaryActive === true, запрещено использовать reference/proposal/choice downstream.
    if (!session.noGuessingInvariant) {
      session.noGuessingInvariant = { active: false, reason: null, enforcedAt: null };
    }
    if (session.clarificationBoundaryActive === true) {
      session.noGuessingInvariant.active = true;
      session.noGuessingInvariant.reason = 'clarification_required';
      session.noGuessingInvariant.enforcedAt = Date.now();
    } else {
      // derived state: если boundary не активна — инвариант не активен
      session.noGuessingInvariant.active = false;
      session.noGuessingInvariant.reason = null;
      session.noGuessingInvariant.enforcedAt = null;
    }

    // Enforcement (поверх существующих блоков, без переписывания логики):
    // - пока noGuessingInvariant.active === true: proposal должен быть отключён (hasProposal=false)
    //   это также блокирует фиксацию explicit choice в текущем проходе (условие explicit choice требует hasProposal=true)
    if (session.noGuessingInvariant.active === true) {
      // Safe reset: не создаём новый объект и не трогаем поля кроме hasProposal/proposedCardId
      if (session.singleReferenceBinding) {
        session.singleReferenceBinding.hasProposal = false;
        session.singleReferenceBinding.proposedCardId = null;
      }
    }

    // 🆕 Sprint VI / Task #1: Candidate Shortlist append (server-side, observation only)
    // Разрешённый источник (ТОЛЬКО): single-reference binding proposal (focus_proposal)
    // Условия:
    // - session.singleReferenceBinding.hasProposal === true
    // - clarificationBoundaryActive === false
    // Правила:
    // - идемпотентно (один cardId — один раз)
    // - только append (без удаления/очистки)
    // - без связи с legacy like / shownSet / lastShown
    if (!session.candidateShortlist || !Array.isArray(session.candidateShortlist.items)) {
      session.candidateShortlist = { items: [] };
    }

    const proposedCardIdForShortlist = session.singleReferenceBinding?.hasProposal === true
      ? session.singleReferenceBinding?.proposedCardId
      : null;

    if (session.clarificationBoundaryActive === false && proposedCardIdForShortlist) {
      const alreadyAdded = session.candidateShortlist.items.some(it => it && it.cardId === proposedCardIdForShortlist);
      if (!alreadyAdded) {
        session.candidateShortlist.items.push({
          cardId: proposedCardIdForShortlist,
          source: 'focus_proposal',
          detectedAt: Date.now()
        });
      }
    }

    // 🆕 Sprint VI / Task #2: Explicit Choice Event (infrastructure only)
    // Устанавливается ТОЛЬКО при одновременном выполнении условий:
    // - singleReferenceBinding.hasProposal === true
    // - clarificationBoundaryActive === false
    // - есть proposedCardId
    // - текст содержит строгий whitelist-маркер явного выбора
    // Если хотя бы одно условие не выполнено → explicitChoiceEvent НЕ устанавливается.
    if (!session.explicitChoiceEvent) {
      session.explicitChoiceEvent = { isConfirmed: false, cardId: null, detectedAt: null, source: 'user_message' };
    }
    if (session.explicitChoiceEvent.isConfirmed !== true) {
      const eligibleForExplicitChoice =
        session.clarificationBoundaryActive === false &&
        session.singleReferenceBinding?.hasProposal === true &&
        Boolean(session.singleReferenceBinding?.proposedCardId);

      if (eligibleForExplicitChoice && detectExplicitChoiceMarker(transcription)) {
        session.explicitChoiceEvent.isConfirmed = true;
        session.explicitChoiceEvent.cardId = session.singleReferenceBinding.proposedCardId;
        session.explicitChoiceEvent.detectedAt = Date.now();
        session.explicitChoiceEvent.source = 'user_message';
        // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
        if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
          session.debugTrace = { items: [] };
        }
        session.debugTrace.items.push({
          type: 'explicit_choice',
          at: Date.now(),
          payload: { cardId: session.explicitChoiceEvent.cardId || null }
        });
      }
    }

    // 🆕 Sprint VI Micro Task: reflect explicitChoiceEvent into candidateShortlist (as separate source)
    // Условия (все одновременно):
    // - explicitChoiceEvent.isConfirmed === true
    // - explicitChoiceEvent.cardId truthy
    // - noGuessingInvariant.active !== true
    // - идемпотентно по (cardId, source='explicit_choice_event')
    if (
      session.explicitChoiceEvent?.isConfirmed === true &&
      Boolean(session.explicitChoiceEvent?.cardId) === true &&
      session.noGuessingInvariant?.active !== true
    ) {
      const alreadyAddedExplicitChoice = session.candidateShortlist?.items?.some(
        (it) => it && it.cardId === session.explicitChoiceEvent.cardId && it.source === 'explicit_choice_event'
      );
      if (!alreadyAddedExplicitChoice) {
        session.candidateShortlist.items.push({
          cardId: session.explicitChoiceEvent.cardId,
          source: 'explicit_choice_event',
          detectedAt: session.explicitChoiceEvent.detectedAt || Date.now()
        });
      }
    }

    // 🆕 Sprint VI / Task #3: Choice Confirmation Boundary (infrastructure only)
    // Write-path: после обработки explicitChoiceEvent.
    // Если explicitChoiceEvent.isConfirmed === true → активируем boundary (один раз, без auto-reset).
    // Если explicitChoiceEvent не подтверждён → boundary не активируется (и не сбрасывается).
    if (!session.choiceConfirmationBoundary) {
      session.choiceConfirmationBoundary = { active: false, chosenCardId: null, detectedAt: null, source: null };
    }
    if (session.choiceConfirmationBoundary.active !== true && session.explicitChoiceEvent?.isConfirmed === true && Boolean(session.explicitChoiceEvent?.cardId) && session.noGuessingInvariant?.active !== true) {
      session.choiceConfirmationBoundary.active = true;
      session.choiceConfirmationBoundary.chosenCardId = session.explicitChoiceEvent.cardId || null;
      session.choiceConfirmationBoundary.detectedAt = session.explicitChoiceEvent.detectedAt || null;
      session.choiceConfirmationBoundary.source = 'explicit_choice_event';
      // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
      session.debugTrace.items.push({
        type: 'choice_boundary',
        at: Date.now(),
        payload: { cardId: session.choiceConfirmationBoundary.chosenCardId || null }
      });
    }
    
    // 🆕 Sprint III: переход role по событию user_message
    transitionRole(session, 'user_message');

    // Логируем сообщение пользователя (event-level logging - существующая телеметрия)
    const audioDurationMs = req.file ? null : null; // TODO: можно добавить извлечение длительности из аудио
    
    logEvent({
      sessionId,
      eventType: EventTypes.USER_MESSAGE,
      userIp,
      userAgent,
      source: 'backend',
      payload: buildPayload({
        inputType: inputTypeForLog,
        text: transcription,
        textLength: transcription.length,
        audioDurationMs,
        stage: session.stage,
        clientProfile: {
          language: session.clientProfile.language,
          location: session.clientProfile.location,
          budgetMin: session.clientProfile.budgetMin,
          budgetMax: session.clientProfile.budgetMax,
          purpose: session.clientProfile.purpose,
          propertyType: session.clientProfile.propertyType,
          urgency: session.clientProfile.urgency
        },
        insights: session.insights,
        cardsCount: session.shownSet ? session.shownSet.size : 0
      })
    }).catch(err => {
      console.error('❌ Failed to log user_message event:', err);
    });

    // Session-level logging: добавляем сообщение пользователя в session_logs
    appendMessage({
      sessionId,
      role: 'user',
      message: {
        inputType: inputTypeForLog,
        text: transcription, // текст всегда есть (либо из транскрипции, либо прямой ввод)
        ...(req.file ? { transcription: transcription } : {}), // для аудио дублируем в transcription
        meta: {
          stage: session.stage,
          insights: session.insights
        }
      },
      userAgent,
      userIp
    }).catch(err => {
      console.error('❌ Failed to append user message to session log:', err);
    });

    // 🤖 Проверяем, нужен ли GPT анализ каждые 5 сообщений
    if (ENABLE_PERIODIC_ANALYSIS) {
      await checkForGPTAnalysis(sessionId);
    }

    // const totalProps = properties.length; // устарело – переезд на БД
    const targetLang = (() => {
      const fromReq = (req.body && req.body.lang) ? String(req.body.lang).toLowerCase() : null;
      if (fromReq) return fromReq;
      const sample = (transcription || req.body.text || '').toString();
      if (/^[\s\S]*[А-Яа-яЁё]/.test(sample)) return 'ru';
      if (/^[\s\S]*[a-zA-Z]/.test(sample)) return 'en';
      return 'ru';
    })();

    // Обновляем стадию и язык перед GPT
    session.stage = determineStage(session.clientProfile, session.stage, session.messages);
    // Установим язык профиля, если ещё не задан: используем эвристику targetLang
    if (!session.clientProfile.language) {
      session.clientProfile.language = targetLang;
    }

    // Базовый системный промпт (личность Джона)
    const baseSystemPrompt = BASE_SYSTEM_PROMPT;

    // Инструкции по стадии и формат ответа
    const stageInstruction = (() => {
      if (session.stage === 'intro') {
        return `Режим: INTRO.
Задача: коротко поприветствовать и понять, с какой задачей по недвижимости обращается клиент.
Ограничения UX:
- Не задавай более одного явного вопроса в одном ответе.
- Не задавай подряд несколько узких анкетных вопросов — приоритет живой диалог.`;
      }
      if (session.stage === 'qualification') {
        return `Режим: QUALIFICATION.
Задача: естественно собрать недостающие параметры профиля (location, budget, purpose и т.п.).
Ограничения UX:
- Не задавай более одного явного вопроса в одном ответе.
- Не задавай подряд несколько узких анкетных вопросов — приоритет живой диалог.`;
      }
      return `Режим: MATCHING_CLOSING.
Задача: опираться на уже известный профиль, предлагать направления/варианты и мягко предлагать следующий шаг.
Ограничения UX:
- Не задавай более одного явного вопроса в одном ответе.
- Не задавай подряд несколько узких анкетных вопросов — приоритет живой диалог.
- CTA допустим только если заполнены хотя бы location и бюджет и уже был обмен несколькими репликами.`;
    })();

    // Инструкция по языку ответа (если определён)
    const languageInstruction = (() => {
      const lang = String(session.clientProfile.language || '').toLowerCase();
      if (lang === 'en') return 'Answer primarily in English.';
      if (lang === 'ru' || !lang) return 'Отвечай преимущественно на русском.';
      return ''; // неизвестный язык — без инструкции
    })();

    const outputFormatInstruction = `Формат ответа строго двухчастный:
1) Текст для пользователя.
2) Строка ---META---
3) JSON:
{
  "clientProfileDelta": {
    // только обновляемые поля профиля, без null и undefined
  },
  "stage": "intro" | "qualification" | "matching_closing"
}
Если нечего обновлять, пришли "clientProfileDelta": {}.`;

    // 🆕 Sprint II / Block A: добавляем allowedFactsSnapshot в контекст модели (если есть факты)
    const allowedFactsInstruction = (() => {
      const snapshot = session.allowedFactsSnapshot || {};
      const hasFacts = snapshot && Object.keys(snapshot).length > 0 && Object.values(snapshot).some(v => v !== null && v !== undefined);
      
      if (!hasFacts) {
        return null; // Если snapshot пустой, не добавляем инструкцию
      }
      
      // Формируем список фактов для модели
      const factsList = [];
      if (snapshot.city) factsList.push(`Город: ${snapshot.city}`);
      if (snapshot.district) factsList.push(`Район: ${snapshot.district}`);
      if (snapshot.neighborhood) factsList.push(`Район/квартал: ${snapshot.neighborhood}`);
      if (snapshot.priceEUR) factsList.push(`Цена: ${snapshot.priceEUR} €`);
      if (snapshot.rooms) factsList.push(`Количество комнат: ${snapshot.rooms}`);
      if (snapshot.floor) factsList.push(`Этаж: ${snapshot.floor}`);
      if (snapshot.hasImage) factsList.push(`Есть изображения: да`);
      
      if (factsList.length === 0) {
        return null;
      }
      
      return `РАЗРЕШЁННЫЕ ФАКТЫ О ПОКАЗАННОЙ КАРТОЧКЕ:
${factsList.join('\n')}

ВАЖНО: Ты можешь говорить только об этих фактах. Не упоминай характеристики объекта, которых нет в списке выше. Можешь интерпретировать, сравнивать, советовать, но не добавляй новых фактов.`;
    })();

    // 🆕 Sprint III: post-handoff mode instruction для AI
    const postHandoffInstruction = (() => {
      if (!session.handoffDone) {
        return null; // До handoff — инструкция не нужна
      }
      
      return `РЕЖИМ POST-HANDOFF:
Ты находишься в post-handoff режиме. Данные лида уже заморожены и не могут быть изменены.

ОГРАНИЧЕНИЯ:
- Не собирай контакт заново (имя, телефон, email).
- Не утверждай, что лид передан менеджеру, если это не подтверждено явно.
- Факты об объектах недвижимости — только из allowedFactsSnapshot (если он предоставлен выше), иначе не упоминай конкретные характеристики объектов.
- Можешь отвечать на вопросы и помогать, но не обновляй профиль клиента или insights.

Продолжай диалог естественно, но соблюдай эти ограничения.`;
    })();

    // 🆕 Sprint II / Block A: исключаем assistant-сообщения из истории, чтобы предотвратить утечку фактов
    // Модель получает только user messages, system prompts и allowedFactsSnapshot
    const userMessages = session.messages.filter(msg => msg.role === 'user');
    
    const messages = [
      {
        role: 'system',
        content: baseSystemPrompt
      },
      {
        role: 'system',
        content: `${stageInstruction}\n\n${outputFormatInstruction}`
      },
      ...(languageInstruction ? [{ role: 'system', content: languageInstruction }] : []),
      ...(allowedFactsInstruction ? [{ role: 'system', content: allowedFactsInstruction }] : []),
      ...(postHandoffInstruction ? [{ role: 'system', content: postHandoffInstruction }] : []),
      ...userMessages
    ];

    const gptStart = Date.now();
    
    // 🔄 Используем retry для GPT API
    const completion = await callOpenAIWithRetry(() => 
      openai.chat.completions.create({
        messages,
        model: 'gpt-4o-mini',
        temperature: 0.5,
        stream: false
      }), 2, 'GPT'
    );
    
    const gptTime = Date.now() - gptStart;

    const fullModelText = completion.choices[0].message.content.trim();
    const { assistantText, meta } = extractAssistantAndMeta(fullModelText);
    let botResponse = assistantText || fullModelText;

    // META обработка: clientProfileDelta + stage
    try {
      const clientProfileDelta = meta?.clientProfileDelta && typeof meta.clientProfileDelta === 'object'
        ? meta.clientProfileDelta
        : {};
      
      // 🆕 Sprint III: после handoff не обновляем clientProfile и insights, только логируем в enrichment
      if (session.handoffDone) {
        addPostHandoffEnrichment(session, 'assistant_meta', JSON.stringify({
          clientProfileDelta: clientProfileDelta,
          stage: meta?.stage || null
        }), {
          role: session.role,
          stage: session.stage
        });
      } else {
        // До handoff: обновляем как раньше
        const updatedProfile = mergeClientProfile(session.clientProfile, clientProfileDelta);
        session.clientProfile = updatedProfile;
        // Валидируем и принимаем stage из META (если прислали)
        const allowedStages = new Set(['intro', 'qualification', 'matching_closing']);
        if (meta && typeof meta.stage === 'string' && allowedStages.has(meta.stage)) {
          session.stage = meta.stage;
        }
        // Синхронизация с insights и пересчёт прогресса
        mapClientProfileToInsights(session.clientProfile, session.insights);
        // Компактный лог обновления профиля и стадии
        const profileLog = {
          language: session.clientProfile.language,
          location: session.clientProfile.location,
          budgetMin: session.clientProfile.budgetMin,
          budgetMax: session.clientProfile.budgetMax,
          purpose: session.clientProfile.purpose,
          propertyType: session.clientProfile.propertyType,
          urgency: session.clientProfile.urgency
        };
        console.log(`🧩 Профиль обновлён [${String(sessionId).slice(-8)}]: ${JSON.stringify(profileLog)} | stage: ${session.stage}`);
      }
    } catch (e) {
      console.log('ℹ️ META отсутствует или невалидна, продолжаем без обновления профиля');
    }

    // 🔎 Детектор намерения/вариантов
    const { show, variants } = detectCardIntent(transcription);
    const schedule = detectScheduleIntent(transcription);

    // UI extras and cards container
    let cards = [];
    let ui = undefined;
    // (удалено) парсинг inline lead из текста и сигналы формы
    const enoughContext = session.insights?.progress >= 66;

   /*
    * УДАЛЁН БЛОК «текстового списка вариантов» (preview-список).
    *
    * Что было:
    * - При достаточном контексте или явном запросе «варианты» генерировался текст:
    *   «У меня есть N вариант(а) из M в базе: ...» с 2–3 строками примеров.
    * - Одновременно сохранялись session.lastCandidates, lastListAt/lastListHash
    *   для антиспама и «якорения» пула кандидатов без показа карточек.
    *
    * Почему убрали:
    * - UX: пользователи ожидают сразу карточки, а не «числа и список строк»; текст создаёт шум.
    * - Несоответствие ожиданиям: подсказка «Сказать „покажи“...» дублирует UI и конфузит.
    * - Надёжность: антиспам по времени/хешу инсайтов давал неочевидные ветки (молчание/повтор),
    *   а цифры «N из M» легко устаревают или воспринимаются как обещание полного каталога.
    * - Мультиязычность: строка не была локализована, что создавало рассинхрон с интерфейсом.
    *
    * Текущая логика:
    * - Пул кандидатов формируется лениво при явном «показать»/навигации по карточкам (см. ниже).
    * - UI предлагает карточку напрямую; числовые «N из M» больше не показываем.
    */

    // Если пользователь просит показать/подробнее — предложим карточку через панель
    if (show && !DISABLE_SERVER_UI) {
      // Начинаем новый "сеанс показа" — сбрасываем набор уже показанных в текущем слайдере
      session.shownSet = new Set();
      // Формируем пул кандидатов: либо существующий, либо заново
      let pool = [];
      if (Array.isArray(session.lastCandidates) && session.lastCandidates.length) {
        pool = session.lastCandidates.slice();
      } else {
        const ranked = await findBestProperties(session.insights, 10);
        const all = ranked.length ? ranked : await getAllNormalizedProperties();
        pool = all.map(p => p.id);
      }
      // Дедупликация пула
      pool = Array.from(new Set(pool));
      session.lastCandidates = pool;
      session.candidateIndex = 0;
      // Выбираем первый id из пула, которого нет в shownSet (она только что сброшена)
      let pickedId = pool[0];
      const allNow = await getAllNormalizedProperties();
      const candidate = allNow.find((p) => p.id === pickedId) || allNow[0];
      if (candidate) {
        session.shownSet.add(candidate.id);
        cards = [formatCardForClient(req, candidate)];
        ui = { suggestShowCard: true };
        // Естественная короткая фраза без технических оговорок
        const lang = getPrimaryLanguage(session) === 'en' ? 'en' : 'ru';
        const phrase = generateShowIntro(lang);
        botResponse = botResponse ? `${botResponse}\n\n${phrase}` : phrase;
      }
    }

    // Если пользователь просит запись/встречу — (удалено) лид-форма не используется

    // (удалено) проактивные предложения лид-формы

    addMessageToSession(sessionId, 'assistant', botResponse);

    const totalTime = Date.now() - startTime;
    const inputType = req.file ? 'аудио' : 'текст'; // для ответа API (русский)

    // Логируем успешный ответ ассистента
    const messageId = `${sessionId}_${Date.now()}`;
    // inputTypeForLog уже объявлен в начале функции
    
    // Подготавливаем данные о карточках для логирования (только ключевые поля)
    const cardsForLog = Array.isArray(cards) && cards.length > 0
      ? cards.map(card => ({
          id: card.id,
          city: card.city || null,
          district: card.district || null,
          priceEUR: card.priceEUR || null,
          rooms: card.rooms || null
        }))
      : [];
    
    // Короткий отрывок сообщения (первые 200 символов)
    const messageText = botResponse ? botResponse.substring(0, 200) : null;
    
    logEvent({
      sessionId,
      eventType: EventTypes.ASSISTANT_REPLY,
      userIp,
      userAgent,
      source: 'backend',
      payload: buildPayload({
        messageId,
        messageText,
        hasCards: cards.length > 0,
        cards: cardsForLog,
        inputType: inputTypeForLog,
        tokens: {
          prompt: completion.usage.prompt_tokens,
          completion: completion.usage.completion_tokens,
          total: completion.usage.total_tokens
        },
        timing: {
          transcription: transcriptionTime,
          gpt: gptTime,
          total: totalTime
        },
        stage: session.stage,
        insights: session.insights
      })
    }).catch(err => {
      console.error('❌ Failed to log assistant_reply event:', err);
    });

    // Session-level logging: добавляем ответ ассистента в session_logs
    appendMessage({
      sessionId,
      role: 'assistant',
      message: {
        text: botResponse,
        cards: cardsForLog,
        tokens: {
          prompt: completion.usage.prompt_tokens,
          completion: completion.usage.completion_tokens,
          total: completion.usage.total_tokens
        },
        timing: {
          transcription: transcriptionTime,
          gpt: gptTime,
          total: totalTime
        },
        meta: {
          stage: session.stage,
          insights: session.insights
        }
      },
      userAgent,
      userIp
    }).catch(err => {
      console.error('❌ Failed to append assistant message to session log:', err);
    });

    res.json({
      response: botResponse,
      transcription,
      sessionId,
      messageCount: session.messages.length,
      inputType,
      clientProfile: session.clientProfile,
      stage: session.stage,
      role: session.role, // 🆕 Sprint I: server-side role
      insights: session.insights, // 🆕 Теперь содержит все 9 параметров
      // ui пропускается, если undefined; cards может быть пустым массивом
      cards: DISABLE_SERVER_UI ? [] : cards,
      ui: DISABLE_SERVER_UI ? undefined : ui,
      tokens: {
        prompt: completion.usage.prompt_tokens,
        completion: completion.usage.completion_tokens,
        total: completion.usage.total_tokens
      },
      timing: {
        transcription: transcriptionTime,
        gpt: gptTime,
        total: totalTime
      }
    });

  } catch (error) {
    console.error(`❌ Ошибка [${sessionId?.slice(-8) || 'unknown'}]:`, error.message);
    
    // Определяем тип ошибки и возвращаем понятное сообщение
    let userMessage = 'Произошла техническая ошибка. Попробуйте еще раз.';
    let statusCode = 500;
    
    if (error.message.includes('OpenAI') || error.message.includes('API')) {
      userMessage = 'Сервис ИИ временно недоступен. Попробуйте через минуту.';
      statusCode = 503;
    } else if (error.message.includes('audio') || error.message.includes('transcription')) {
      userMessage = 'Не удалось обработать аудио. Попробуйте записать заново.';
      statusCode = 422;
    } else if (error.message.includes('timeout')) {
      userMessage = 'Запрос выполняется слишком долго. Попробуйте сократить сообщение.';
      statusCode = 408;
    }
    
    // Логируем ошибку
    // userIp и userAgent уже объявлены в начале функции
    
    // Обрезаем stack до разумной длины (первые 500 символов)
    const stackTruncated = error.stack ? error.stack.substring(0, 500) : null;
    
    logEvent({
      sessionId: sessionId || null,
      eventType: EventTypes.ERROR,
      userIp,
      userAgent,
      source: 'backend',
      payload: buildPayload({
        scope: 'backend',
        message: error.message,
        stack: stackTruncated,
        meta: {
          statusCode,
          path: req.path,
          method: req.method,
          eventType: 'transcribeAndRespond'
        }
      })
    }).catch(err => {
      console.error('❌ Failed to log error event:', err);
    });

    // Session-level logging: добавляем системное сообщение об ошибке в session_logs
    if (sessionId) {
      appendMessage({
        sessionId,
        role: 'system',
        message: {
          text: `Ошибка: ${error.message}`,
          meta: {
            statusCode,
            path: req.path,
            method: req.method
          }
        },
        userAgent,
        userIp
      }).catch(err => {
        console.error('❌ Failed to append error message to session log:', err);
      });
    }
    
    res.status(statusCode).json({ 
      error: userMessage,
      timestamp: new Date().toISOString(),
      requestId: sessionId?.slice(-8) || 'unknown'
    });
  }
};

const clearSession = (sessionId) => {
  sessions.delete(sessionId);
};

// ✅ Получить статистику всех активных сессий
const getStats = (req, res) => {
  const sessionStats = [];

  sessions.forEach((session, sessionId) => {
    sessionStats.push({
      sessionId,
      messageCount: session.messages.length,
      lastActivity: session.lastActivity,
      insights: session.insights // 🆕 Теперь содержит все 9 параметров
    });
  });

  res.json({
    totalSessions: sessions.size,
    sessions: sessionStats
  });
};

// ✅ Получение полной информации о сессии по ID
const getSessionInfo = (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Сессия не найдена' });
  }

  res.json({
    sessionId,
    clientProfile: session.clientProfile,
    stage: session.stage,
    role: session.role, // 🆕 Sprint I: server-side role
    insights: session.insights, // 🆕 Теперь содержит все 9 параметров
    messageCount: session.messages.length,
    lastActivity: session.lastActivity,
    // 🆕 Sprint IV: distinction between shown and focused (для валидации/debug)
    currentFocusCard: session.currentFocusCard || { cardId: null, updatedAt: null },
    lastShown: session.lastShown || { cardId: null, updatedAt: null },
    lastFocusSnapshot: session.lastFocusSnapshot || null,
    // 🆕 Sprint V: reference and ambiguity states (для валидации/debug)
    referenceIntent: session.referenceIntent || null,
    referenceAmbiguity: session.referenceAmbiguity || { isAmbiguous: false, reason: null, detectedAt: null, source: 'server_contract' },
    clarificationRequired: session.clarificationRequired || { isRequired: false, reason: null, detectedAt: null, source: 'server_contract' },
    singleReferenceBinding: session.singleReferenceBinding || { hasProposal: false, proposedCardId: null, source: 'server_contract', detectedAt: null, basis: null },
    clarificationBoundaryActive: session.clarificationBoundaryActive || false,
    // 🆕 Sprint VI / Task #1: Candidate Shortlist (debug/diagnostics only)
    candidateShortlist: session.candidateShortlist || { items: [] },
    // 🆕 Sprint VI / Task #2: Explicit Choice Event (debug/diagnostics only)
    explicitChoiceEvent: session.explicitChoiceEvent || { isConfirmed: false, cardId: null, detectedAt: null, source: 'user_message' },
    // 🆕 Sprint VI / Task #3: Choice Confirmation Boundary (debug/diagnostics only)
    choiceConfirmationBoundary: session.choiceConfirmationBoundary || { active: false, chosenCardId: null, detectedAt: null, source: null },
    // 🆕 Sprint VI / Task #4: No-Guessing Invariant (debug/diagnostics only)
    noGuessingInvariant: session.noGuessingInvariant || { active: false, reason: null, enforcedAt: null },
    // 🆕 Sprint VII / Task #1: Unknown UI Actions (debug/diagnostics only)
    unknownUiActions: session.unknownUiActions || { count: 0, items: [] },
    // 🆕 Sprint VII / Task #2: Debug Trace (debug/diagnostics only)
    debugTrace: session.debugTrace || { items: [] }
  });
};

// 🆕 Sprint III: централизованная функция установки handoff как boundary-события
const triggerHandoff = (session, reason = 'lead_submitted') => {
  if (!session) {
    console.warn('⚠️ [Sprint III] triggerHandoff вызван без session');
    return false;
  }
  
  if (session.handoffDone) {
    console.log(`ℹ️ [Sprint III] Handoff уже выполнен для сессии ${session.sessionId?.slice(-8) || 'unknown'}`);
    return false;
  }
  
  // 🆕 Sprint III: создаём lead snapshot как часть boundary-события
  if (!session.leadSnapshot) {
    const snapshotAt = Date.now();
    session.leadSnapshot = {
      sessionId: session.sessionId || null,
      createdAt: session.createdAt || null,
      snapshotAt: snapshotAt,
      clientProfile: session.clientProfile ? { ...session.clientProfile } : null,
      insights: session.insights ? { ...session.insights } : null,
      // Дополнительные данные, если они есть
      likedProperties: Array.isArray(session.liked) ? [...session.liked] : null,
      shownProperties: session.shownSet ? Array.from(session.shownSet) : null
    };
    session.leadSnapshotAt = snapshotAt;
    console.log(`📸 [Sprint III] Lead snapshot создан для сессии ${session.sessionId?.slice(-8) || 'unknown'}`);
  }
  
  session.handoffDone = true;
  session.handoffAt = Date.now();
  console.log(`✅ [Sprint III] Handoff установлен для сессии ${session.sessionId?.slice(-8) || 'unknown'} (reason: ${reason})`);
  return true;
};

// 🆕 Sprint III: централизованная функция установки completion (завершение диалога после handoff)
const triggerCompletion = (session, reason = 'post_handoff_cycle_complete') => {
  if (!session) {
    console.warn('⚠️ [Sprint III] triggerCompletion вызван без session');
    return false;
  }
  
  // Completion возможен только после handoff
  if (!session.handoffDone) {
    console.warn(`⚠️ [Sprint III] Completion невозможен до handoff (сессия ${session.sessionId?.slice(-8) || 'unknown'})`);
    return false;
  }
  
  // Идемпотентность: если completion уже установлен, не перезаписываем
  if (session.completionDone) {
    console.log(`ℹ️ [Sprint III] Completion уже выполнен для сессии ${session.sessionId?.slice(-8) || 'unknown'}`);
    return false;
  }
  
  session.completionDone = true;
  session.completionAt = Date.now();
  session.completionReason = reason;
  console.log(`✅ [Sprint III] Completion установлен для сессии ${session.sessionId?.slice(-8) || 'unknown'} (reason: ${reason})`);
  return true;
};

// ✅ Экспорт всех нужных функций
export {
  transcribeAndRespond,
  clearSession,
  getSessionInfo,
  getStats,
  handleInteraction,
  triggerHandoff,
  triggerCompletion
};

// ---------- Взаимодействия (like / next) ----------
async function handleInteraction(req, res) {
  try {
    const { action, variantId, sessionId } = req.body || {};
    if (!action || !sessionId) return res.status(400).json({ error: 'action и sessionId обязательны' });
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
    if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
      session.debugTrace = { items: [] };
    }
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only) — 100% UI action coverage (single write)
    session.debugTrace.items.push({
      type: 'ui_action',
      at: Date.now(),
      payload: { action }
    });

    // Обеспечим список кандидатов в сессии
    if (!Array.isArray(session.lastCandidates) || !session.lastCandidates.length) {
      const ranked = await findBestProperties(session.insights, 10);
      // Если нет ничего по инсайтам — используем всю базу
      const pool = ranked.length ? ranked : await getAllNormalizedProperties();
      session.lastCandidates = pool.map(p => p.id);
      session.candidateIndex = 0;
    } else if (session.lastCandidates.length < 2) {
      // Гарантируем минимум 2 кандидата, расширив до всей базы (без дубликатов)
      const set = new Set(session.lastCandidates);
      const all = await getAllNormalizedProperties();
      for (const p of all) { if (!set.has(p.id)) set.add(p.id); }
      session.lastCandidates = Array.from(set);
      if (!Number.isInteger(session.candidateIndex)) session.candidateIndex = 0;
    }

    if (action === 'show') {
      // Первый показ выбранной карточки: вернуть саму карточку и динамический комментарий
      const list = session.lastCandidates || [];
      // Если фронт прислал variantId — используем его, иначе возьмём текущий индекс/первый
      let id = variantId;
      if (!id) {
        const all = await getAllNormalizedProperties();
        id = list[Number.isInteger(session.candidateIndex) ? session.candidateIndex : 0] || (all[0] && all[0].id);
      }
      const all = await getAllNormalizedProperties();
      const p = all.find(x => x.id === id) || all[0];
      if (!p) return res.status(404).json({ error: 'Карточка не найдена' });
      // Обновим индекс и отметим показанным
      session.candidateIndex = list.indexOf(id);
      if (!session.shownSet) session.shownSet = new Set();
      session.shownSet.add(p.id);
      const card = formatCardForClient(req, p);
      const lang = getPrimaryLanguage(session) === 'en' ? 'en' : 'ru';
      const assistantMessage = generateCardComment(lang, p);
      return res.json({ ok: true, assistantMessage, card, role: session.role }); // 🆕 Sprint I: server-side role
    }

    if (action === 'next') {
      // Перейти к следующему подходящему объекту
      const list = session.lastCandidates || [];
      const len = list.length;
      if (!len) {
        // крайний случай: вернём первый из базы
        const all = await getAllNormalizedProperties();
        const p = all[0];
        const card = formatCardForClient(req, p);
        const lang = getPrimaryLanguage(session) === 'en' ? 'en' : 'ru';
        const assistantMessage = generateCardComment(lang, p);
        return res.json({ ok: true, assistantMessage, card, role: session.role }); // 🆕 Sprint I: server-side role
      }
      // Если фронт прислал текущий variantId, делаем шаг относительно него
      let idx = list.indexOf(variantId);
      if (idx === -1) {
        idx = Number.isInteger(session.candidateIndex) ? session.candidateIndex : 0;
      }
      // Подготовим набор уже показанных в текущем показе
      if (!session.shownSet) session.shownSet = new Set();
      // Найдём следующий id, которого ещё не было показано в текущем показе
      let steps = 0;
      let nextIndex = (idx + 1) % len;
      let id = list[nextIndex];
      while (steps < len && session.shownSet.has(id)) {
        nextIndex = (nextIndex + 1) % len;
        id = list[nextIndex];
        steps++;
      }
      // Если все кандидаты уже показаны — расширим пул лучшими по инсайтам и возьмём первый новый
      if (steps >= len) {
        const extended = (await findBestProperties(session.insights, 100)).map(p => p.id);
        const unseen = extended.find(cid => !session.shownSet.has(cid));
        if (unseen) {
          id = unseen;
          // добавим в пул для будущих переключений
          const set = new Set(list);
          set.add(id);
          session.lastCandidates = Array.from(set);
        }
      }
      session.candidateIndex = list.indexOf(id);
      const all2 = await getAllNormalizedProperties();
      const p = all2.find(x => x.id === id) || all2[0];
      session.shownSet.add(p.id);
      const card = formatCardForClient(req, p);
      const lang = getPrimaryLanguage(session) === 'en' ? 'en' : 'ru';
      const assistantMessage = generateCardComment(lang, p);
      return res.json({ ok: true, assistantMessage, card, role: session.role }); // 🆕 Sprint I: server-side role
    }

    if (action === 'like') {
      // Сохраним лайк для аналитики (минимально)
      session.liked = session.liked || [];
      if (variantId) session.liked.push(variantId);
      const count = session.liked.length;
      const msg = `Супер, сохранил! Могу предложить записаться на просмотр или показать ещё варианты. Что выберем? (понравилось: ${count})`;
      return res.json({ ok: true, assistantMessage: msg, role: session.role }); // 🆕 Sprint I: server-side role
    }

    // 🆕 Sprint I: подтверждение факта рендера карточки в UI
    if (action === 'ui_card_rendered') {
      if (!variantId) {
        return res.status(400).json({ error: 'variantId обязателен для ui_card_rendered' });
      }
      // Фиксируем карточку как показанную в server state
      if (!session.shownSet) session.shownSet = new Set();
      session.shownSet.add(variantId);
      
      // 🆕 Sprint IV: обновляем lastShown при ui_card_rendered (отдельно от currentFocusCard)
      if (!session.lastShown) {
        session.lastShown = { cardId: null, updatedAt: null };
      }
      session.lastShown.cardId = variantId;
      session.lastShown.updatedAt = Date.now();
      
      // 🆕 Sprint III: переход role по событию ui_card_rendered
      transitionRole(session, 'ui_card_rendered');
      
      // 🆕 Sprint II / Block A: наполняем allowedFactsSnapshot фактами показанной карточки
      try {
        const all = await getAllNormalizedProperties();
        const cardData = all.find(p => p.id === variantId);
        
        if (cardData) {
          // Формируем snapshot строго по ALLOWED_FACTS_SCHEMA
          const snapshot = {};
          
          // Извлекаем факты согласно schema
          ALLOWED_FACTS_SCHEMA.forEach(field => {
            if (field === 'cardId') {
              snapshot.cardId = variantId;
            } else if (field === 'hasImage') {
              // Специальная обработка для hasImage (вычисляемый факт)
              snapshot.hasImage = !!(cardData.images && Array.isArray(cardData.images) && cardData.images.length > 0);
            } else {
              // Прямое извлечение полей из cardData
              snapshot[field] = cardData[field] || null;
            }
          });
          
          session.allowedFactsSnapshot = snapshot;
          console.log(`✅ [Sprint II] allowedFactsSnapshot наполнен фактами карточки ${variantId} по schema (сессия ${sessionId.slice(-8)})`);
        } else {
          console.warn(`⚠️ [Sprint II] Карточка ${variantId} не найдена для наполнения snapshot`);
        }
      } catch (e) {
        console.error(`❌ [Sprint II] Ошибка при наполнении allowedFactsSnapshot:`, e);
      }
      
      console.log(`✅ [Sprint I] Карточка ${variantId} зафиксирована как показанная в UI (сессия ${sessionId.slice(-8)})`);
      return res.json({ ok: true, role: session.role }); // 🆕 Sprint I: server-side role
    }

    // 🆕 Sprint IV: обработка события ui_slider_started для фиксации активности slider
    if (action === 'ui_slider_started') {
      if (!session.sliderContext) {
        session.sliderContext = { active: false, updatedAt: null };
      }
      session.sliderContext.active = true;
      session.sliderContext.updatedAt = Date.now();
      console.log(`📱 [Sprint IV] Slider стал активным (сессия ${sessionId.slice(-8)})`);
      return res.json({ ok: true, role: session.role });
    }

    // 🆕 Sprint III: обработка события ui_slider_ended для перехода role
    // 🆕 Sprint IV: также обновляем sliderContext при завершении slider
    if (action === 'ui_slider_ended') {
      // 🆕 Sprint III: переход role по событию ui_slider_ended
      transitionRole(session, 'ui_slider_ended');
      
      // 🆕 Sprint IV: обновляем sliderContext
      if (!session.sliderContext) {
        session.sliderContext = { active: false, updatedAt: null };
      }
      session.sliderContext.active = false;
      session.sliderContext.updatedAt = Date.now();
      console.log(`📱 [Sprint IV] Slider стал неактивным (сессия ${sessionId.slice(-8)})`);
      
      return res.json({ ok: true, role: session.role }); // 🆕 Sprint I: server-side role
    }

    // 🆕 Sprint IV: обработка события ui_focus_changed для фиксации текущей карточки в фокусе
    if (action === 'ui_focus_changed') {
      const cardId = req.body.cardId;
      
      if (!cardId || typeof cardId !== 'string' || cardId.trim().length === 0) {
        console.warn(`⚠️ [Sprint IV] ui_focus_changed с невалидным cardId (сессия ${sessionId.slice(-8)})`);
        return res.status(400).json({ error: 'cardId is required and must be a non-empty string' });
      }
      
      if (!session.currentFocusCard) {
        session.currentFocusCard = { cardId: null, updatedAt: null };
      }
      
      const trimmedCardId = cardId.trim();
      session.currentFocusCard.cardId = trimmedCardId;
      session.currentFocusCard.updatedAt = Date.now();
      
      // 🆕 Sprint IV: обновляем lastFocusSnapshot при ui_focus_changed (отдельно от lastShown и allowedFactsSnapshot)
      session.lastFocusSnapshot = {
        cardId: trimmedCardId,
        updatedAt: Date.now()
      };
      
      console.log(`🎯 [Sprint IV] Focus изменён на карточку ${trimmedCardId} (сессия ${sessionId.slice(-8)})`);
      return res.json({ ok: true, role: session.role });
    }

    // 🆕 Sprint VII / Task #1: Unknown UI Action Capture (diagnostics only)
    // Неизвестный action не должен ломать выполнение и не должен вызывать side-effects.
    if (!session.unknownUiActions || !Array.isArray(session.unknownUiActions.items)) {
      session.unknownUiActions = { count: 0, items: [] };
    }
    session.unknownUiActions.count += 1;
    session.unknownUiActions.items.push({
      action: String(action),
      payload: req.body ? { ...req.body } : null,
      detectedAt: Date.now()
    });
    return res.json({ ok: true, role: session.role });
  } catch (e) {
    console.error('interaction error:', e);
    res.status(500).json({ error: 'internal' });
  }
}