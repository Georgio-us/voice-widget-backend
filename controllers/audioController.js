import { File } from 'node:buffer';
globalThis.File = File;
import { OpenAI } from 'openai';
// DB repository (Postgres)
import { getAllProperties } from '../services/propertiesRepository.js';
import { BASE_SYSTEM_PROMPT } from '../services/personality.js';
import { logEvent, EventTypes, buildPayload } from '../services/eventLogger.js';
// Session-level logging: логирование целого диалога по одной строке на сессию
import { appendMessage, upsertSessionLog } from '../services/sessionLogger.js';
import { sendSessionActivityStartToTelegram, updateSessionActivityFinalToTelegram } from '../services/telegramNotifier.js';
const DISABLE_SERVER_UI = String(process.env.DISABLE_SERVER_UI || '').trim() === '1';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();
const INSIGHTS_RESPONSE_SCHEMA = {
  name: 'insights_response',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['assistant_text', 'insights'],
    properties: {
      assistant_text: { type: 'string' },
      insights: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'operation', 'budget', 'type', 'location', 'rooms', 'area', 'details', 'preferences'],
        properties: {
          name: { type: ['string', 'null'] },
          operation: { type: ['string', 'null'], enum: ['buy', 'rent', null] },
          budget: { type: ['number', 'string', 'null'] },
          type: { type: ['string', 'null'], enum: ['apartment', 'house', 'land', null] },
          location: { type: ['string', 'null'] },
          rooms: { type: ['number', 'string', 'null'] },
          area: { type: ['number', 'string', 'null'] },
          details: { type: ['string', 'null'] },
          preferences: { type: ['string', 'null'] }
        }
      }
    }
  },
  strict: true
};

// ====== Diagnostic build tag (DEPLOY_TAG) ======
const DEPLOY_TAG_FULL = process.env.DEPLOY_TAG || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown';
const DEPLOY_TAG_SHORT = (() => {
  const t = String(DEPLOY_TAG_FULL || 'unknown');
  if (t.length <= 8) return t;
  return t.slice(-8);
})();
const getDeployShortOrNull = () => (DEPLOY_TAG_FULL && DEPLOY_TAG_FULL !== 'unknown' ? DEPLOY_TAG_SHORT : null);
let BUILD_LOGGED = false;
const logBuildOnce = () => {
  if (BUILD_LOGGED) return;
  BUILD_LOGGED = true;
  console.log(`[BUILD] deploy=${DEPLOY_TAG_FULL}`);
};

// ====== Client-visible debug gate (Safari-friendly) ======
const isClientDebugEnabled = (req) => {
  const envOn = String(process.env.VW_DEBUG_CLIENT || '').trim() === '1';
  const headerOn = String(req?.headers?.['x-vw-debug'] || '').trim() === '1';
  return envOn && headerOn;
};

const clip = (str, n = 80) => {
  if (str === null || str === undefined) return '';
  const s = String(str);
  if (s.length <= n) return s;
  return s.slice(0, n);
};

const normalizeForClientDebug = (text) => {
  if (!text || typeof text !== 'string') return '';
  return String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractSpokeCardId = (text) => {
  if (!text || typeof text !== 'string') return { cardId: null, confidence: 'none' };
  const matches = String(text).match(/\bA\d{3}\b/g) || [];
  const uniq = Array.from(new Set(matches));
  if (uniq.length === 1) return { cardId: uniq[0], confidence: 'exact' };
  return { cardId: null, confidence: 'none' };
};

const getLatestMatchRuleId = (session) => {
  const items = session?.debugTrace?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.type === 'reference_detected') {
      return it?.payload?.matchRuleId || null;
    }
  }
  return null;
};

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

const ROLE_SEARCH_READY = 'search_ready';

// 🆕 Sprint III: централизованная функция смены role через state machine
const transitionRole = (session, event) => {
  const currentRole = session?.role || ROLE_SEARCH_READY;
  if (!session) return false;
  if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
    session.debugTrace = { items: [] };
  }
  session.role = ROLE_SEARCH_READY;
  session.debugTrace.items.push({
    type: 'role_transition',
    at: Date.now(),
    payload: { from: currentRole, to: session.role, event }
  });
  return true;
};

const cleanupOldSessions = () => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      // RMv3: best-effort Telegram final update on session expiry (TTL-based finalization)
      try {
        const messageId = session?.telegram?.activityMessageId || null;
        if (messageId) {
          updateSessionActivityFinalToTelegram({
            messageId,
            sessionId: session?.sessionId || sessionId,
            startedAt: session?.createdAt ?? null,
            lastActivityAt: session?.lastActivity ?? null,
            durationMs: (typeof session?.createdAt === 'number' && typeof session?.lastActivity === 'number')
              ? Math.max(0, session.lastActivity - session.createdAt)
              : null,
            geo: session?.geo || null,
            messageCount: Array.isArray(session?.messages) ? session.messages.length : null,
            sliderReached: !!(session?.sliderContext && session.sliderContext.updatedAt),
            insights: session?.insights || null,
            cardsShownCount: session?.shownSet ? (session.shownSet.size || 0) : null,
            likesCount: Array.isArray(session?.liked) ? session.liked.length : null,
            selectedCardId: session?.selectedCard?.cardId || null,
            handoffActive: session?.handoff?.shownAt ? true : (session?.handoff?.active === true),
            handoffCanceled: session?.handoff?.canceled === true
          }).catch(() => {});
        }
      } catch {}
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
      stage: 'matching_closing',
      // 🆕 Sprint III: server-side role (детерминированное состояние через state machine)
      role: ROLE_SEARCH_READY,
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
      extractionMetrics: {
        turnsTotal: 0,
        metaPresentTurns: 0,
        parseErrors: 0,
        validationErrors: 0,
        updatesApplied: 0,
        fieldFilledTurns: {
          name: 0,
          operation: 0,
          budget: 0,
          type: 0,
          location: 0,
          rooms: 0,
          area: 0,
          details: 0,
          preferences: 0
        }
      },
      metaContract: {
        needsRepairHint: false,
        lastError: null,
        lastMetaRaw: null,
        lastUpdatedAt: null
      },
      // 🆕 Sprint II / Block A: allowedFactsSnapshot (разрешённые факты для AI)
      // Формируется только после подтверждённого показа карточки (ui_card_rendered)
      // Пока не используется ни UI, ни AI — чистое введение структуры
      allowedFactsSnapshot: {},
      // 🆕 Sprint III: handoff как системный механизм (boundary), не роль
      handoffDone: false,
      handoffAt: null,
      // RMv3 / Sprint 2 / Task 2.1: handoff как server-fact "активирован/показан" (UI state driven, server-first)
      // ВАЖНО:
      // - не роль/стадия
      // - не влияет на LLM напрямую в этой задаче
      // - не трогает lead-flow
      handoff: {
        active: false,
        shownAt: null,
        cardId: null,
        canceled: false,
        canceledAt: null
      },
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
      // RMv3 / Sprint 1 / Task 1: факт выбора карточки пользователем (UI "Выбрать") — server-first
      selectedCard: {
        cardId: null,
        selectedAt: null
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

// Show-intent: RU + EN + ES. Used only for computing isShow in detectCardIntent.
const SHOW_INTENT_PATTERNS = [
  // RU: "покажи", "покажи карточку", "посмотреть" и т.д.
  /(покажи(те)?\s*(ее|её)?\s*(подробнее)?|показать\s*(ее|её)?|посмотреть\s*(ее|её)?|карточк|сюда\s*отправь|давай\s*карточку|подробн)/i,
  // EN: show, show me, show please/pls/plz, can you show, show (this) card/listing/listings/options/properties/variants
  /\b(show|show\s+me|show\s+please|show\s+pls|show\s+plz|can\s+you\s+show|show\s+(this\s+)?(card|listing|listings|options|properties|variants))\b/i,
  // ES: muestra, muéstrame, mostrar, enséñame, ver (la) ficha/opciones/propiedades
  /\b(muestra|muéstrame|mostrar|enséñame|ver\s+(la\s+)?(ficha|opciones|propiedades))\b/i
];

const detectCardIntent = (text = '') => {
  const t = String(text).toLowerCase();
  const isShow = SHOW_INTENT_PATTERNS.some(re => re.test(t));
  const isVariants = /(какие|что)\s+(есть|можно)\s+(вариант|квартир)/i.test(t)
    || /подбери(те)?|подобрать|вариант(ы)?|есть\s+вариант/i.test(t)
    || /квартир(а|ы|у)\s+(есть|бывают)/i.test(t);
  return { show: isShow, variants: isVariants };
};

// RMv3 / Sprint 4 / Task 4.4: demo-only "словесный выбор объекта"
// ВАЖНО:
// - максимально простой regex/keyword match (без NLP)
// - НЕ "покажи" (это отдельный show-intent)
// - триггер работает только если есть lastShown/currentFocusCard (никаких догадок)
const detectVerbalSelectIntent = (text = '') => {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return false;
  // Предохранитель: "покажи"/"show" — это show-intent, не выбор
  if (/(покажи(те)?|показать|посмотреть)/i.test(t)) return false;
  if (/\b(show|show\s+me|can\s+you\s+show)\b/i.test(t)) return false;
  // Сигнал "выбор/подходит/нравится" + указание на "этот/эта/последний вариант"
  const hasChoiceCue = /(понрав|нравит|подход|устраива|бер(у|ем|ём)|давай|выбираю|остановимс|ок\b)/i.test(t);
  const hasTargetCue = /(эт(от|а|у)\s+(вариант|квартир)|эт(от|а|у)\b|последн(ий|яя|ю)\b|последн(ий|яя|ю)\s+(вариант|квартир))/i.test(t);
  // "мне нравится этот вариант" → true; "подходит" без указания → false
  return hasChoiceCue && hasTargetCue;
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
    'дубай марина': 'dubai marina', 'марина': 'dubai marina', 'dubai marina': 'dubai marina',
    'downtown': 'downtown', 'даунтаун': 'downtown', 'downtown dubai': 'downtown',
    'jvc': 'jvc', 'джвс': 'jvc', 'дживиси': 'jvc', 'jumeirah village circle': 'jvc',
    'business bay': 'business bay', 'бизнес бей': 'business bay', 'бизнес бай': 'business bay',
    'bluewaters': 'bluewaters', 'bluewaters island': 'bluewaters', 'блювотерс': 'bluewaters',
    'dubai hills': 'dubai hills', 'дубай хиллс': 'dubai hills', 'dubai hills estate': 'dubai hills',
    'jbr': 'jbr', 'джей би ар': 'jbr', 'jumeirah beach residence': 'jbr',
    'palm jumeirah': 'palm jumeirah', 'пальма джумейра': 'palm jumeirah',
    'creek harbour': 'creek harbour', 'dubai creek harbour': 'creek harbour', 'крик харбор': 'creek harbour',
    'emaar beachfront': 'emaar beachfront', 'beachfront': 'emaar beachfront', 'эмаар бичфронт': 'emaar beachfront',
    'city walk': 'city walk', 'сити вок': 'city walk',
    'damac lagoons': 'damac lagoons', 'лагаунс': 'damac lagoons'
  };
  return map[s] || s;
};

const hasHardFilters = (insights = {}) => {
  return Boolean(insights?.operation || insights?.budget || insights?.type);
};

const normalizeOperationForProperty = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'buy' || raw === 'sale' || raw === 'sell' || raw === 'purchase') return 'buy';
  if (raw === 'rent' || raw === 'lease' || raw === 'rental') return 'rent';
  return null;
};

const normalizeTypeForProperty = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (/(apartment|flat|апартамент|апарты|квартир)/i.test(raw)) return 'apartment';
  if (/(house|villa|home|townhouse|дом|вилл|таунхаус)/i.test(raw)) return 'house';
  if (/(land|plot|участок|земля)/i.test(raw)) return 'land';
  return null;
};

const passHardFilters = (p, insights = {}) => {
  const expectedOperation = normalizeOperationForProperty(insights.operation);
  if (expectedOperation) {
    const actualOperation = normalizeOperationForProperty(p.operation);
    if (!actualOperation || actualOperation !== expectedOperation) return false;
  }

  const expectedType = normalizeTypeForProperty(insights.type);
  if (expectedType) {
    const actualType = normalizeTypeForProperty(p.property_type);
    if (!actualType || actualType !== expectedType) return false;
  }

  const budget = parseBudgetEUR(insights.budget);
  if (budget != null && Number.isFinite(budget)) {
    const price = Number(p.priceEUR);
    if (!Number.isFinite(price) || price > budget) return false;
  }

  return true;
};

const scoreProperty = (p, insights) => {
  if (!passHardFilters(p, insights)) return 0;

  let score = 1;
  // rooms
  const roomsNum = (() => {
    const m = insights.rooms && String(insights.rooms).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  })();
  if (roomsNum != null && Number(p.rooms) === roomsNum) score += 2;
  // location (insights.location хранит район/локацию)
  const insightDistrict = normalizeDistrict(insights.location);
  const propDistrict = normalizeDistrict(p.district || p.neighborhood || p.city);
  if (insightDistrict && propDistrict) {
    if (propDistrict === insightDistrict) score += 3;
    else if (propDistrict.includes(insightDistrict) || insightDistrict.includes(propDistrict)) score += 2;
  }

  // budget proximity bonus (после прохождения hard-budget)
  const budget = parseBudgetEUR(insights.budget);
  if (budget != null && Number.isFinite(budget)) {
    const price = Number(p.priceEUR);
    if (Number.isFinite(price)) {
      const diff = Math.abs(price - budget) / (budget || 1);
      if (diff <= 0.1) score += 2;
      else if (diff <= 0.2) score += 1;
    }
  }

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
    operation: row.operation || null,
    property_type: row.property_type || null,
    priceEUR: row.price_amount != null ? Number(row.price_amount) : null,
    price_per_m2: row.price_per_m2 != null ? Number(row.price_per_m2) : null,
    rooms: row.specs_rooms != null ? Number(row.specs_rooms) : null,
    bathrooms: row.specs_bathrooms != null ? Number(row.specs_bathrooms) : null,
    area_m2: row.specs_area_m2 != null ? Number(row.specs_area_m2) : null,
    floor: row.specs_floor != null ? Number(row.specs_floor) : null,
    description: row.description || null,
    images,
  };
};

const getAllNormalizedProperties = async () => {
  const rows = await getAllProperties();
  return rows.map(mapRowToProperty);
};

const rankPropertiesByInsights = (properties, insights) => {
  const rankedRows = properties
    .map((p) => ({ p, s: scoreProperty(p, insights) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s);
  return {
    ranked: rankedRows.map(({ p }) => p),
    totalMatches: rankedRows.length
  };
};

const getRankedProperties = async (insights) => {
  const all = await getAllNormalizedProperties();
  return rankPropertiesByInsights(all, insights);
};

const findBestProperties = async (insights, limit = 1) => {
  const { ranked } = await getRankedProperties(insights);
  return ranked.slice(0, limit);
};

const getBaseUrl = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return host ? `${proto}://${host}` : '';
};

const formatNumberUS = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric).toLocaleString('en-US');
};

const detectBudgetCurrency = (text = '') => {
  const s = String(text || '').toLowerCase();
  if (/\b(aed|dirham|dirhams|дирхам|дирхама|дирхамов)\b/.test(s)) return 'AED';
  if (/(\$|\busd\b|\bdollar\b|\bdollars\b|доллар|доллара|долларов)/.test(s)) return 'USD';
  // Dubai demo default
  return 'USD';
};

const formatCardForClient = (req, p) => {
  const baseUrl = getBaseUrl(req);
  const images = (Array.isArray(p.images) ? p.images : [])
    .map((src) => String(src || '').trim())
    .filter(Boolean)
    .map((src) => src.replace('https://<backend-host>', baseUrl));
  const image = images.length ? images[0] : null;
  const formattedPrice = formatNumberUS(p.priceEUR ?? p?.price?.amount);
  return {
    id: p.id,
    // Левые поля (география)
    city: p.city ?? p?.location?.city ?? null,
    district: p.district ?? p?.location?.district ?? null,
    neighborhood: p.neighborhood ?? p?.location?.neighborhood ?? null,
    // Правые поля (основные цифры)
    price: formattedPrice ? `${formattedPrice} AED` : null,
    priceEUR: p.priceEUR ?? p?.price?.amount ?? null,
    rooms: p.rooms ?? p?.specs?.rooms ?? null,
    floor: p.floor ?? p?.specs?.floor ?? null,
    // Дополнительные поля для back-стороны карточки
    description: p.description ?? null,
    area_m2: p.area_m2 ?? p?.specs?.area_m2 ?? null,
    price_per_m2: p.price_per_m2 ?? null,
    bathrooms: p.bathrooms ?? p?.specs?.bathrooms ?? null,
    // Изображение
    image,
    imageUrl: image,
    images
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

const getUiLanguage = (session) => {
  const lang = String(getPrimaryLanguage(session) || '').toLowerCase();
  if (lang === 'en') return 'en';
  if (lang === 'es') return 'es';
  return 'ru';
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

// Insights больше не извлекаются regex-логикой.
// Смыслы обновляются только через LLM META и mapClientProfileToInsights.
const updateInsights = (sessionId, newMessage) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.handoffDone) {
    addPostHandoffEnrichment(session, 'user_message', newMessage, {
      role: session.role,
      stage: session.stage
    });
  }

  const current = session.insights || {};
  const normalized = {
    name: current.name ?? null,
    operation: current.operation ?? null,
    budget: current.budget ?? null,
    type: current.type ?? null,
    location: current.location ?? null,
    rooms: current.rooms ?? null,
    area: current.area ?? null,
    details: current.details ?? null,
    preferences: current.preferences ?? null,
    progress: 0
  };

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
  for (const [field, weight] of Object.entries(weights)) {
    const value = normalized[field];
    if (value != null && String(value).trim().length > 0) {
      totalProgress += weight;
    }
  }
  normalized.progress = Math.min(totalProgress, 99);
  session.insights = normalized;
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

// ====== RMv3 / Sprint 1 / Task 1: LLM Context Pack + structured [CTX] log (infrastructure only) ======
// ВАЖНО:
// - Context Pack transient: НЕ сохраняется в session, НЕ влияет на логику/промпты/ответ
// - [CTX] — одна читаемая строка перед каждым LLM-вызовом (chat.completions)
const buildLlmContextPack = (session, sessionId, call) => {
  // RMv3 / Sprint 1 / Task 2:
  // Нормализованный контракт LLM Context Pack (только server-side facts, без вычислений и без записи в session).
  const sid = String(sessionId || session?.sessionId || '');
  const meta = {
    sessionId: sid,
    role: session?.role ?? null,
    stage: session?.stage ?? null,
    call: call ?? null
  };

  const cp = session?.clientProfile || {};
  const clientProfile = {
    language: cp.language ?? null,
    location: cp.location ?? null,
    purpose: cp.purpose ?? null,
    // budget — скалярный server-fact (без нормализации/парсинга):
    // приоритет: clientProfile.budget -> budgetMax -> budgetMin -> insights.budget -> null
    budget: (cp.budget ?? cp.budgetMax ?? cp.budgetMin ?? session?.insights?.budget ?? null),
    // rooms как server-fact: если нет в clientProfile, читаем из insights (если есть)
    rooms: (cp.rooms ?? session?.insights?.rooms ?? null)
  };

  const uiContext = {
    currentFocusCard: { cardId: session?.currentFocusCard?.cardId ?? null },
    lastShown: { cardId: session?.lastShown?.cardId ?? null },
    lastFocusSnapshot: { cardId: session?.lastFocusSnapshot?.cardId ?? null },
    sliderActive: session?.sliderContext?.active === true
  };

  const referencePipeline = {
    referenceIntent: { type: session?.referenceIntent?.type ?? null },
    referenceAmbiguity: { isAmbiguous: session?.referenceAmbiguity?.isAmbiguous === true },
    clarificationRequired: { isRequired: session?.clarificationRequired?.isRequired === true },
    clarificationBoundaryActive: session?.clarificationBoundaryActive === true,
    singleReferenceBinding: {
      hasProposal: session?.singleReferenceBinding?.hasProposal === true,
      proposedCardId: session?.singleReferenceBinding?.proposedCardId ?? null
    }
  };

  const shortlistItems = Array.isArray(session?.candidateShortlist?.items)
    ? session.candidateShortlist.items
        .filter((it) => it && it.cardId)
        .map((it) => ({ cardId: it.cardId }))
    : [];

  const choice = {
    candidateShortlist: { items: shortlistItems },
    explicitChoiceEvent: { isConfirmed: session?.explicitChoiceEvent?.isConfirmed === true },
    choiceConfirmationBoundary: { active: session?.choiceConfirmationBoundary?.active === true }
  };

  const invariants = {
    noGuessingInvariant: { active: session?.noGuessingInvariant?.active === true }
  };

  // RMv3 / Sprint 1 / Task 3: Facts Bundle (allowedFacts + cardFacts) for relevant cardIds
  // ВАЖНО: никаких вычислений/нормализаций фактов — только прокидывание server-facts.
  const factsCardIdsCandidates = [
    session?.singleReferenceBinding?.proposedCardId ?? null,
    session?.currentFocusCard?.cardId ?? null,
    session?.lastShown?.cardId ?? null,
    session?.lastFocusSnapshot?.cardId ?? null,
    ...(Array.isArray(session?.candidateShortlist?.items)
      ? session.candidateShortlist.items.slice(0, 3).map((it) => it?.cardId ?? null)
      : [])
  ];

  const factsCardIds = [];
  for (const id of factsCardIdsCandidates) {
    if (!id) continue;
    if (factsCardIds.includes(id)) continue;
    factsCardIds.push(id);
    if (factsCardIds.length >= 5) break;
  }

  const cardFactsById = {};
  for (const cardId of factsCardIds) {
    cardFactsById[String(cardId)] = session?.cardFacts?.[cardId] ?? null;
  }

  const facts = {
    allowedFactsSnapshot: session?.allowedFactsSnapshot ?? null,
    cardFactsById,
    factsCardIds
  };

  return { meta, clientProfile, uiContext, referencePipeline, choice, invariants, facts };
};

const formatCtxLogLine = (pack) => {
  // [CTX] логирует ТОЛЬКО нормализованный Context Pack (RMv3 / Sprint 1 / Task 2).
  const deploy = DEPLOY_TAG_SHORT;
  const sid = String(pack?.meta?.sessionId || '');
  const shortSid = sid ? sid.slice(-8) : 'unknown';
  const role = pack?.meta?.role ?? null;
  const stage = pack?.meta?.stage ?? null;
  const call = pack?.meta?.call ?? null;
  const budget = pack?.clientProfile?.budget ?? null;

  const focus = pack?.uiContext?.currentFocusCard?.cardId ?? null;
  const lastShown = pack?.uiContext?.lastShown?.cardId ?? null;
  const lastFocus = pack?.uiContext?.lastFocusSnapshot?.cardId ?? null;
  const slider = pack?.uiContext?.sliderActive === true;

  const refType = pack?.referencePipeline?.referenceIntent?.type ?? null;
  const amb = pack?.referencePipeline?.referenceAmbiguity?.isAmbiguous === true;
  const clarReq = pack?.referencePipeline?.clarificationRequired?.isRequired === true;
  const clarBoundary = pack?.referencePipeline?.clarificationBoundaryActive === true;
  const bind = pack?.referencePipeline?.singleReferenceBinding?.hasProposal === true;
  const bindCard = pack?.referencePipeline?.singleReferenceBinding?.proposedCardId ?? null;

  const shortlistIds = Array.isArray(pack?.choice?.candidateShortlist?.items)
    ? Array.from(new Set(pack.choice.candidateShortlist.items.map((it) => it?.cardId).filter(Boolean)))
    : [];
  const choice = pack?.choice?.explicitChoiceEvent?.isConfirmed === true;
  const choiceBoundary = pack?.choice?.choiceConfirmationBoundary?.active === true;

  const noGuess = pack?.invariants?.noGuessingInvariant?.active === true;
  const factsIds = Array.isArray(pack?.facts?.factsCardIds) ? pack.facts.factsCardIds.filter(Boolean) : [];
  const factsCount = factsIds.length;
  const allowedFacts = (() => {
    const snap = pack?.facts?.allowedFactsSnapshot ?? null;
    if (!snap || typeof snap !== 'object') return false;
    return Object.keys(snap).length > 0;
  })();

  const fmt = (v) => (v === null || v === undefined || v === '' ? 'null' : String(v));
  const fmtBool = (b) => (b ? '1' : '0');

  // Одна строка, плоский читаемый формат, стабильный порядок полей.
  return `[CTX] deploy=${deploy} sid=${shortSid} role=${fmt(role)} stage=${fmt(stage)} call=${fmt(call)} budget=${fmt(budget)} focus=${fmt(focus)} lastShown=${fmt(lastShown)} lastFocus=${fmt(lastFocus)} slider=${fmtBool(slider)} ref=${fmt(refType)} amb=${fmtBool(amb)} clarReq=${fmtBool(clarReq)} clarBoundary=${fmtBool(clarBoundary)} bind=${fmtBool(bind)} bindCard=${fmt(bindCard)} shortlist=[${shortlistIds.join(',')}] choice=${fmtBool(choice)} choiceBoundary=${fmtBool(choiceBoundary)} noGuess=${fmtBool(noGuess)} factsIds=[${factsIds.join(',')}] allowedFacts=${fmtBool(allowedFacts)} factsCount=${fmt(factsCount)}`;
};

const logCtx = (pack) => {
  try {
    logBuildOnce();
    console.log(formatCtxLogLine(pack));
  } catch (e) {
    // diagnostics only — не ломаем runtime
    console.log('[CTX] (failed_to_format)');
  }
};

// RMv3 / Sprint 1 / Task 5: expose server facts to LLM as the FIRST system message (infrastructure only)
// content format (strict): "RMV3_SERVER_FACTS_V1 " + JSON.stringify(shapedPack)
// NOTE: Shaping reduces token usage; diagnostics ([CTX]) still uses the full normalized pack.
const buildCardSummaryLines = (shaped) => {
  const ids = Array.isArray(shaped?.facts?.factsCardIds) ? shaped.facts.factsCardIds.slice(0, 3) : [];
  const byId = (shaped?.facts?.cardFactsById && typeof shaped.facts.cardFactsById === 'object')
    ? shaped.facts.cardFactsById
    : {};

  const lines = [];
  for (const cardId of ids) {
    if (!cardId) continue;
    const raw = byId[cardId] && typeof byId[cardId] === 'object' ? byId[cardId] : null;

    const city = raw?.city ?? null;
    const district = raw?.district ?? null;
    const neighborhood = raw?.neighborhood ?? null;
    const rooms = raw?.rooms ?? null;
    const priceEUR = raw?.priceEUR ?? null;
    const price = raw?.price ?? null;

    const parts = [String(cardId)];

    const locParts = [city, district, neighborhood].filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (locParts.length > 0) {
      parts.push(locParts.map(String).join(', '));
    }

    if (rooms !== null && rooms !== undefined && String(rooms).trim() !== '') {
      const roomsStr = String(rooms);
      const alreadyHasRoomsWord = /\brooms?\b/i.test(roomsStr) || /\bкомн/i.test(roomsStr);
      parts.push(alreadyHasRoomsWord ? roomsStr : `${roomsStr} rooms`);
    }

    const priceVal = (priceEUR !== null && priceEUR !== undefined && String(priceEUR).trim() !== '')
      ? { key: 'priceEUR', val: priceEUR }
      : ((price !== null && price !== undefined && String(price).trim() !== '') ? { key: 'price', val: price } : null);

    if (priceVal) {
      const s = String(priceVal.val);
      const hasCurrencyHint = /€|eur/i.test(s);
      parts.push(hasCurrencyHint ? s : `${priceVal.key}=${s}`);
    }

    // Если кроме id ничего нет — строка должна быть просто CARD_ID
    lines.push(parts.join(' | '));
  }

  return lines.slice(0, 3);
};

const buildShapedFactsPackForLLM = (pack) => {
  const meta = {
    sessionId: pack?.meta?.sessionId ?? null,
    role: pack?.meta?.role ?? null,
    stage: pack?.meta?.stage ?? null,
    call: pack?.meta?.call ?? null
  };

  const ui = {
    currentFocusCardId: pack?.uiContext?.currentFocusCard?.cardId ?? null,
    lastShownCardId: pack?.uiContext?.lastShown?.cardId ?? null
  };

  const ref = {
    referenceIntentType: pack?.referencePipeline?.referenceIntent?.type ?? null,
    ambiguity: pack?.referencePipeline?.referenceAmbiguity?.isAmbiguous === true,
    clarificationRequired: pack?.referencePipeline?.clarificationRequired?.isRequired === true,
    clarificationBoundaryActive: pack?.referencePipeline?.clarificationBoundaryActive === true,
    binding: {
      hasProposal: pack?.referencePipeline?.singleReferenceBinding?.hasProposal === true,
      proposedCardId: pack?.referencePipeline?.singleReferenceBinding?.proposedCardId ?? null
    }
  };

  const rawAllowed = pack?.facts?.allowedFactsSnapshot ?? null;
  const allowedFactsKeys = (rawAllowed && typeof rawAllowed === 'object')
    ? Object.keys(rawAllowed).slice(0, 20)
    : [];
  const allowedFactsCount = (rawAllowed && typeof rawAllowed === 'object')
    ? Object.keys(rawAllowed).length
    : 0;

  // factsCardIds max 3 (priority): proposed -> focus -> lastShown
  const factsCardIds = [];
  const candIds = [
    ref.binding.proposedCardId ?? null,
    ui.currentFocusCardId ?? null,
    ui.lastShownCardId ?? null
  ];
  for (const id of candIds) {
    if (!id) continue;
    if (factsCardIds.includes(id)) continue;
    factsCardIds.push(id);
    if (factsCardIds.length >= 3) break;
  }

  const whitelist = new Set([
    'id',
    'cardId',
    'title',
    'city',
    'district',
    'neighborhood',
    'price',
    'priceEUR',
    'rooms',
    'area',
    'floor'
  ]);

  const cardFactsById = {};
  for (const cardId of factsCardIds) {
    const raw = pack?.facts?.cardFactsById?.[cardId] ?? null;
    if (!raw || typeof raw !== 'object') {
      cardFactsById[String(cardId)] = null;
      continue;
    }
    const shapedCard = {};
    for (const key of Object.keys(raw)) {
      if (!whitelist.has(key)) continue;
      const val = raw[key];
      if (val === undefined || val === null) continue;
      shapedCard[key] = val;
    }
    // если вообще ничего не попало — всё равно возвращаем объект (не null), чтобы видеть "есть, но пусто"
    cardFactsById[String(cardId)] = shapedCard;
  }

  const shaped = {
    meta,
    ui,
    ref,
    clarificationMode:
      ref.clarificationBoundaryActive === true ||
      ref.ambiguity === true ||
      ref.clarificationRequired === true,
    facts: {
      factsCardIds,
      allowedFactsKeys,
      allowedFactsCount,
      cardFactsById
    }
  };

  shaped.facts.cardSummaryLines = buildCardSummaryLines(shaped);

  return shaped;
};

// ====== Вспомогательные функции профиля/META ======

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
  const minFormatted = formatNumberUS(minNum);
  const maxFormatted = formatNumberUS(maxNum);
  if (minFormatted && maxFormatted) return `${minFormatted}–${maxFormatted} AED`;
  if (!minFormatted && maxFormatted) return `до ${maxFormatted} AED`;
  if (minFormatted && !maxFormatted) return `от ${minFormatted} AED`;
  return null;
};

const INSIGHT_FIELDS = ['name', 'operation', 'budget', 'type', 'location', 'rooms', 'area', 'details', 'preferences'];

const recalcInsightsProgress = (insights) => {
  if (!insights || typeof insights !== 'object') return;
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
  for (const [field, weight] of Object.entries(weights)) {
    const val = insights[field];
    if (val != null && String(val).trim()) totalProgress += weight;
  }
  insights.progress = Math.min(totalProgress, 99);
};

const sanitizeInsightValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const cleaned = value.map((item) => String(item ?? '').trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(', ') : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('value' in value) return sanitizeInsightValue(value.value);
    try {
      const packed = JSON.stringify(value);
      return packed && packed !== '{}' ? packed : null;
    } catch {
      return null;
    }
  }
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
  const explicitBudget = sanitizeInsightValue(clientProfile.budget);
  const budgetStr = explicitBudget || formatBudgetFromRange(clientProfile.budgetMin, clientProfile.budgetMax);
  if (budgetStr) insights.budget = budgetStr;
  // Локация
  const location = sanitizeInsightValue(clientProfile.location);
  if (location) insights.location = location;
  // Тип
  const propertyType = sanitizeInsightValue(clientProfile.propertyType);
  if (propertyType) insights.type = propertyType;
  // Операция
  const op = mapPurposeToOperationRu(clientProfile.purpose);
  if (op) insights.operation = op;
  const operation = sanitizeInsightValue(clientProfile.operation);
  if (operation) insights.operation = operation;
  // Срочность → предпочтения
  if (clientProfile.urgency && /сроч/i.test(String(clientProfile.urgency))) {
    insights.preferences = 'срочный поиск';
  }
  // Поля clientProfile, полезные для debug/подбора
  for (const [profileKey, insightKey] of [
    ['name', 'name'],
    ['rooms', 'rooms'],
    ['area', 'area'],
    ['details', 'details'],
    ['preferences', 'preferences']
  ]) {
    const val = sanitizeInsightValue(clientProfile[profileKey]);
    if (val) insights[insightKey] = val;
  }
  recalcInsightsProgress(insights);
};

const applyMetaInsightsToSession = (session, meta) => {
  if (!session || !meta || typeof meta !== 'object') return { applied: false, invalidFields: ['meta'] };
  const sourceInsights = (meta.insights && typeof meta.insights === 'object' && !Array.isArray(meta.insights))
    ? meta.insights
    : null;
  if (!sourceInsights) return { applied: false, invalidFields: ['insights'] };
  if (!session.insights || typeof session.insights !== 'object') {
    session.insights = {};
  }

  const parseBudgetNumber = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    const compact = raw.replace(/\s+/g, '');
    const match = compact.match(/^(\d+(?:[.,]\d+)?)(k|к|тыс|тысяч|m|м|млн|million|миллион|миллиона|миллионов)?$/i);
    if (match) {
      const base = Number(String(match[1]).replace(',', '.'));
      if (!Number.isFinite(base)) return null;
      const suffix = String(match[2] || '').toLowerCase();
      if (['k', 'к', 'тыс', 'тысяч'].includes(suffix)) return Math.round(base * 1000);
      if (['m', 'м', 'млн', 'million', 'миллион', 'миллиона', 'миллионов'].includes(suffix)) return Math.round(base * 1000000);
      return Math.round(base);
    }
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parseRoomsNumber = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    const namedRooms = {
      'студия': 0,
      'studio': 0,
      'однушка': 1,
      'one bedroom': 1,
      '1 bedroom': 1,
      'двушка': 2,
      'two bedroom': 2,
      '2 bedroom': 2,
      'трешка': 3,
      'трёшка': 3,
      'three bedroom': 3,
      '3 bedroom': 3,
      'четырешка': 4,
      'четырёшка': 4,
      'four bedroom': 4,
      '4 bedroom': 4
    };
    if (Object.prototype.hasOwnProperty.call(namedRooms, raw)) return namedRooms[raw];
    const numeric = raw.match(/\d+/);
    if (!numeric) return null;
    const parsed = Number(numeric[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const normalizeOperation = (value) => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (/(buy|purchase|invest|покуп|купить|инвест)/i.test(raw)) return 'buy';
    if (/(rent|lease|аренд|снять)/i.test(raw)) return 'rent';
    return null;
  };
  const normalizeType = (value) => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (/(apartment|flat|квартир|апартамент|апарты)/i.test(raw)) return 'apartment';
    if (/(house|villa|home|дом|вилл)/i.test(raw)) return 'house';
    if (/(land|plot|участок|земля)/i.test(raw)) return 'land';
    if (raw === 'apartment' || raw === 'house' || raw === 'land') return raw;
    return null;
  };

  const parseNumeric = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.replace(',', '.');
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  };

  const invalidFields = [];
  let appliedCount = 0;
  for (const field of INSIGHT_FIELDS) {
    const incoming = sourceInsights[field];
    if (incoming === undefined) continue;
    let nextValue = null;
    if (field === 'budget') nextValue = parseBudgetNumber(incoming);
    else if (field === 'rooms') nextValue = parseRoomsNumber(incoming);
    else if (field === 'operation') nextValue = normalizeOperation(incoming);
    else if (field === 'type') nextValue = normalizeType(incoming);
    else if (field === 'area') nextValue = parseNumeric(incoming);
    else nextValue = sanitizeInsightValue(incoming);
    if (nextValue === null || nextValue === undefined || String(nextValue).trim() === '') {
      invalidFields.push(field);
      continue;
    }
    session.insights[field] = nextValue;
    appliedCount += 1;
  }
  recalcInsightsProgress(session.insights);
  console.log('[INSIGHTS_UPDATE] Updates applied:', session.insights);

  // best-effort persistence in session_logs for cross-request visibility/debug
  try {
    const sid = String(session.sessionId || '').trim();
    if (sid) {
      upsertSessionLog({
        sessionId: sid,
        payloadPatch: {
          latestInsights: session.insights,
          latestInsightsUpdatedAt: new Date().toISOString(),
          extractionMetrics: session.extractionMetrics || null
        }
      }).catch(() => {});
    }
  } catch {}
  return { applied: appliedCount > 0, invalidFields };
};

const ensureExtractionMetrics = (session) => {
  if (!session.extractionMetrics || typeof session.extractionMetrics !== 'object') {
    session.extractionMetrics = {};
  }
  const m = session.extractionMetrics;
  m.turnsTotal = Number(m.turnsTotal || 0);
  m.metaPresentTurns = Number(m.metaPresentTurns || 0);
  m.parseErrors = Number(m.parseErrors || 0);
  m.validationErrors = Number(m.validationErrors || 0);
  m.updatesApplied = Number(m.updatesApplied || 0);
  if (!m.fieldFilledTurns || typeof m.fieldFilledTurns !== 'object') {
    m.fieldFilledTurns = {};
  }
  for (const f of INSIGHT_FIELDS) {
    m.fieldFilledTurns[f] = Number(m.fieldFilledTurns[f] || 0);
  }
  return m;
};

const updateExtractionMetrics = (session, report = {}) => {
  if (!session) return;
  const m = ensureExtractionMetrics(session);
  m.turnsTotal += 1;
  if (report.metaPresent === true) m.metaPresentTurns += 1;
  if (report.parseError === true) m.parseErrors += 1;
  if (report.validationError === true) m.validationErrors += 1;
  if (report.updatesApplied === true) m.updatesApplied += 1;
  for (const f of INSIGHT_FIELDS) {
    const v = session.insights?.[f];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      m.fieldFilledTurns[f] += 1;
    }
  }
  const turns = Math.max(1, m.turnsTotal);
  const fillRates = {};
  for (const f of INSIGHT_FIELDS) {
    fillRates[f] = Number((m.fieldFilledTurns[f] / turns).toFixed(3));
  }
  const parseErrorRate = Number((m.parseErrors / turns).toFixed(3));
  console.log('[INSIGHTS_METRICS]', {
    turnsTotal: m.turnsTotal,
    parseErrorRate,
    updatesApplied: m.updatesApplied,
    fillRates
  });
};

// 🆕 Sprint V: детекция reference в тексте пользователя (без интерпретации)
// 🔧 Hotfix: Reference Detector Stabilization (Roadmap v2)
// ВАЖНО: JS \b НЕ работает с кириллицей, поэтому RU матчим через пробельные границы
const detectReferenceIntent = (text) => {
  if (!text || typeof text !== 'string') return null;

  const normalized = String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Unicode-safe normalization:
    // - keep all letters/numbers across scripts (incl. ES diacritics/ñ)
    // - strip diacritics (é -> e, ñ -> n) for stable matching
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  // Пробельные границы для RU (JS \b не работает с кириллицей)
  const norm = ' ' + normalized + ' ';

  // order: multi -> single -> unknown -> null

  // === MULTI (RU через includes, EN через regex \b) ===
  const multiRuChecks = [
    { id: 'multi_ru_vot_eti', phrase: ' вот эти ' },
    { id: 'multi_ru_eti_varianty', phrase: ' эти варианты ' },
    { id: 'multi_ru_eti_kvartiry', phrase: ' эти квартиры ' },
    { id: 'multi_ru_eti', phrase: ' эти ' },
    { id: 'multi_ru_oba', phrase: ' оба ' },
    { id: 'multi_ru_neskolko', phrase: ' несколько ' }
  ];
  for (const r of multiRuChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // ES multi (через includes; без \b)
  const multiEsChecks = [
    { id: 'multi_es_estas', phrase: ' estas ' },
    { id: 'multi_es_estos', phrase: ' estos ' },
    { id: 'multi_es_esas', phrase: ' esas ' },
    { id: 'multi_es_esos', phrase: ' esos ' },
    { id: 'multi_es_aquellos', phrase: ' aquellos ' },
    { id: 'multi_es_aquellas', phrase: ' aquellas ' }
  ];
  for (const r of multiEsChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // EN multi (regex ok)
  if (/\bthese\b/.test(normalized)) return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'multi_en_these' };
  if (/\bboth\b/.test(normalized)) return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'multi_en_both' };

  // === SINGLE (RU через includes, EN через regex \b) ===
  const singleRuChecks = [
    { id: 'single_ru_vot_eta', phrase: ' вот эта ' },
    { id: 'single_ru_vot_eto', phrase: ' вот это ' },
    // 🆕 Patch (outside Roadmap): RU accusative pointer forms ("эту / про эту / вот эту")
    // ВАЖНО: порядок важен — более специфичные формы должны матчиться раньше, чем "эту"
    { id: 'single_ru_vot_etu', phrase: ' вот эту ' },
    { id: 'single_ru_pro_etu', phrase: ' про эту ' },
    { id: 'single_ru_i_eta', phrase: ' и эта ' },
    { id: 'single_ru_eta_tozhe', phrase: ' эта тоже ' },
    { id: 'single_ru_eta_norm', phrase: ' эта норм ' },
    { id: 'single_ru_eta_kvartira', phrase: ' эта квартира ' },
    { id: 'single_ru_etot_variant', phrase: ' этот вариант ' },
    { id: 'single_ru_eto', phrase: ' это ' },
    { id: 'single_ru_etu', phrase: ' эту ' },
    { id: 'single_ru_eta', phrase: ' эта ' }
  ];
  for (const r of singleRuChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // ES single (через includes; без \b)
  const singleEsChecks = [
    { id: 'single_es_esta', phrase: ' esta ' },
    { id: 'single_es_este', phrase: ' este ' },
    { id: 'single_es_esa', phrase: ' esa ' },
    { id: 'single_es_ese', phrase: ' ese ' },
    { id: 'single_es_aquel', phrase: ' aquel ' },
    { id: 'single_es_aquella', phrase: ' aquella ' }
  ];
  for (const r of singleEsChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // EN single (regex ok)
  if (/\bthis one\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_this_one' };
  if (/\bthat one\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_that_one' };
  if (/\bthis\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_this' };
  if (/\bthat\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_that' };

  // === UNKNOWN (RU через includes, EN через regex \b) ===
  const unknownRuChecks = [
    { id: 'unknown_ru_tot_variant', phrase: ' тот вариант ' },
    { id: 'unknown_ru_tot', phrase: ' тот ' },
    { id: 'unknown_ru_takaya', phrase: ' такая ' }
  ];
  for (const r of unknownRuChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'unknown', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // EN unknown (regex ok)
  if (/\bthat one there\b/.test(normalized)) return { type: 'unknown', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'unknown_en_that_one_there' };

  return null;
};

// ====== RMv3 / Sprint 2 / Task 1: Reference Fallback Gate (WHEN to call LLM fallback) ======
// ВАЖНО:
// - Не вызывает LLM
// - Не меняет session
// - Не пишет в referenceIntent
// - Не логирует при false
// - При true: один лог [REF_FALLBACK_GATE] reason=eligible
const shouldUseReferenceFallback = (session, userInput) => {
  // A) Reference detector не сработал
  if (!(session?.referenceIntent == null)) return false;

  // Sprint 2 / Task 10: do NOT call fallback if server is already in clarification/boundary mode
  if (
    session?.referenceAmbiguity?.isAmbiguous === true ||
    session?.clarificationRequired?.isRequired === true ||
    session?.clarificationBoundaryActive === true
  ) {
    return false;
  }

  // B) Есть активный UI-контекст (server-truth)
  const hasActiveUiContext =
    Boolean(session?.currentFocusCard?.cardId) ||
    session?.singleReferenceBinding?.hasProposal === true ||
    (Array.isArray(session?.candidateShortlist?.items) && session.candidateShortlist.items.length > 0);
  if (!hasActiveUiContext) return false;

  // C) Сообщение короткое и указательное
  if (typeof userInput !== 'string') return false;
  const raw = userInput;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 15) return false;
  // Block any numeric characters (ASCII + Unicode digits)
  if (/\p{Number}/u.test(trimmed)) return false;
  if (/(€|\$|\beur\b|\busd\b)/i.test(trimmed)) return false;

  // D) Похоже на ссылку, а не вопрос/описание
  const normalized = trimmed
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Unicode-safe normalization (ES diacritics + punctuation handling)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  // быстрый отсев: вопросы/описания/фильтры/глаголы
  if (/[?]/.test(trimmed)) return false;
  const banned = [
    // RU verbs / intent
    /покаж/i, /показат/i, /хочу/i, /интерес/i, /нрав/i, /отправ/i, /пришл/i, /дай/i, /возьм/i, /выбер/i,
    // RU filters
    /цен/i, /район/i, /комнат/i, /площад/i, /метр/i, /\bдо\b/i,
    // EN verbs / intent
    /\bshow\b/i, /\bwant\b/i, /\blike\b/i, /\bsend\b/i, /\bchoose\b/i, /\btake\b/i,
    // EN filters / question-ish
    /\bprice\b/i, /\bdistrict\b/i, /\barea\b/i, /\brooms?\b/i, /\bunder\b/i, /\bup\s*to\b/i,
    /\bwhat\b/i, /\bwhich\b/i, /\bhow\b/i, /\bwhy\b/i
  ];
  if (banned.some((re) => re.test(normalized))) return false;

  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;

  const allowedSingle = new Set([
    'эта', 'эт', 'eto', 'eta',
    'this', 'that', 'thsi', 'dis',
    // ES minimal deictics (Sprint 2 / Task 6)
    'esta', 'este', 'eso', 'esa', 'estas', 'estos', 'ese', 'aquel',
    'one', 'onee'
  ]);
  const allowedFirstForOne = new Set([
    'this', 'that', 'thsi', 'dis',
    // ES minimal deictics (Sprint 2 / Task 6)
    'esta', 'este', 'eso', 'esa', 'estas', 'estos', 'ese', 'aquel'
  ]);
  const allowedSecond = new Set(['one', 'onee']);

  let eligible = false;
  if (words.length === 1) {
    eligible = allowedSingle.has(words[0]);
  } else if (words.length === 2) {
    eligible = allowedFirstForOne.has(words[0]) && allowedSecond.has(words[1]);
  }

  if (!eligible) return false;

  // Диагностика: логируем только при true
  const sid = String(session?.sessionId || '').slice(-8) || 'unknown';
  const safeInput = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  console.log(`[REF_FALLBACK_GATE] sid=${sid} input="${safeInput}" reason=eligible`);
  return true;
};

// ====== RMv3 / Sprint 2 / Task 2: LLM reference fallback classifier (classifier only) ======
// ВАЖНО:
// - Возвращает только классификацию referenceType + диагностические поля
// - Не выбирает карточки, не читает UI, не добавляет факты
// - При любой ошибке/мусоре возвращает безопасный дефолт
const REF_FALLBACK_CONFIDENCE_THRESHOLD = 0.6;
async function classifyReferenceIntentFallbackLLM({ openai, text, language }) {
  const safeDefault = {
    referenceType: null,
    normalizedText: null,
    confidence: 0,
    reasonTag: 'other'
  };

  try {
    if (!text || typeof text !== 'string') return safeDefault;
    const langHint = typeof language === 'string' && language.trim() ? language.trim().toLowerCase() : null;

    const system = [
      'You are a strict JSON-only classifier.',
      'Return ONLY valid JSON. No extra text, no markdown, no code fences.',
      'Task: classify a short user utterance as a reference intent only.',
      'You MUST NOT pick any card or infer UI state.',
      '',
      'Output schema (exact keys only):',
      '{',
      '  "referenceType": "single" | "multi" | "unknown" | null,',
      '  "normalizedText": string | null,',
      '  "confidence": number,',
      '  "reasonTag": "typo" | "keyboard_layout" | "mixed_language" | "other" | null',
      '}',
      '',
      'Rules:',
      '- If not confident, set referenceType=null and confidence=0.',
      '- confidence must be between 0 and 1.',
      '- normalizedText: a cleaned/lowercased version of the input (or null).',
      '- Keep it minimal and deterministic.'
    ].join('\n');

    const user = JSON.stringify({
      text: String(text),
      language: langHint
    });

    const completion = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 160,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }), 2, 'REF-Fallback-Classifier'
    );

    const raw = completion?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== 'string') return safeDefault;

    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return safeDefault;
    }

    const allowedTypes = new Set(['single', 'multi', 'unknown']);
    const allowedReasons = new Set(['typo', 'keyboard_layout', 'mixed_language', 'other']);

    const referenceType = (parsed && typeof parsed.referenceType === 'string' && allowedTypes.has(parsed.referenceType))
      ? parsed.referenceType
      : (parsed?.referenceType === null ? null : null);

    const normalizedText = (parsed && typeof parsed.normalizedText === 'string' && parsed.normalizedText.trim())
      ? parsed.normalizedText
      : null;

    const confidence = (parsed && typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) && parsed.confidence >= 0 && parsed.confidence <= 1)
      ? parsed.confidence
      : 0;

    const reasonTag = (parsed && typeof parsed.reasonTag === 'string' && allowedReasons.has(parsed.reasonTag))
      ? parsed.reasonTag
      : (parsed?.reasonTag === null ? null : 'other');

    return { referenceType, normalizedText, confidence, reasonTag };
  } catch {
    return safeDefault;
  }
}

const extractAssistantAndMeta = (fullText) => {
  try {
    const marker = '---META---';
    const idx = fullText.indexOf(marker);
    if (idx === -1) {
      return { assistantText: fullText, meta: null, metaRaw: null, parseError: false };
    }
    const assistantText = fullText.slice(0, idx).trim();
    let jsonPart = fullText.slice(idx + marker.length).trim();
    // Срезаем возможные бэктики
    jsonPart = jsonPart.replace(/```json\s*|\s*```/g, '').trim();
    // Защитимся от слишком длинного хвоста
    if (jsonPart.length > 5000) jsonPart = jsonPart.slice(0, 5000);
    let parsed = null;
    let parseError = false;
    try {
      parsed = JSON.parse(jsonPart);
    } catch {
      parsed = null;
      parseError = true;
    }
    return { assistantText, meta: parsed, metaRaw: jsonPart, parseError };
  } catch {
    return { assistantText: fullText, meta: null, metaRaw: null, parseError: true };
  }
};

const parseStructuredInsightsResponse = (content) => {
  const fail = { assistantText: null, meta: null, raw: content ?? null, parseError: true };
  if (typeof content !== 'string' || !content.trim()) return fail;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return fail;
    const assistantText = typeof parsed.assistant_text === 'string' ? parsed.assistant_text.trim() : '';
    const insights = parsed.insights && typeof parsed.insights === 'object' ? parsed.insights : null;
    if (!assistantText || !insights) return fail;
    return {
      assistantText,
      meta: { insights },
      raw: content,
      parseError: false
    };
  } catch {
    return fail;
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
    const isNewSession = !sessions.has(sessionId);
    const session = getOrCreateSession(sessionId);
    // RMv3: Telegram "someone is using the widget right now" (on first real user request = first /upload)
    // ВАЖНО:
    // - НЕ по клику "открыть виджет", а по факту обращения (/upload)
    // - best-effort: не ломает основной поток
    // - храним message_id в session, чтобы потом обновить тем же сообщением при финализации (TTL/clear)
    try {
      if (isNewSession === true) {
        const tgUser = {
          userId: req.body?.tgUserId ? String(req.body.tgUserId).trim() : null,
          username: req.body?.tgUsername ? String(req.body.tgUsername).trim() : null,
          firstName: req.body?.tgFirstName ? String(req.body.tgFirstName).trim() : null,
          lastName: req.body?.tgLastName ? String(req.body.tgLastName).trim() : null
        };
        // best-effort geo from headers (no external dependencies)
        const h = (k) => {
          try { return req?.headers?.[k] || req?.headers?.[String(k || '').toLowerCase()] || null; } catch { return null; }
        };
        const country =
          (h('cf-ipcountry') || h('x-vercel-ip-country') || h('x-country') || h('x-geo-country') || null);
        const city =
          (h('x-vercel-ip-city') || h('x-city') || h('x-geo-city') || h('cf-ipcity') || null);
        const geo = {
          ...(country ? { country: String(country).trim() } : {}),
          ...(city ? { city: String(city).trim() } : {})
        };
        const hasTgUser = Object.values(tgUser).some((v) => String(v || '').trim().length > 0);
        if (hasTgUser) {
          session.telegramUser = {
            ...(tgUser.userId ? { userId: tgUser.userId } : {}),
            ...(tgUser.username ? { username: tgUser.username } : {}),
            ...(tgUser.firstName ? { firstName: tgUser.firstName } : {}),
            ...(tgUser.lastName ? { lastName: tgUser.lastName } : {})
          };
        }
        upsertSessionLog({
          sessionId,
          userAgent,
          userIp,
          payloadPatch: {
            sessionMeta: {
              ...(hasTgUser ? { telegramUser: session.telegramUser } : {})
            }
          }
        }).catch(() => {});
        // store on session (server is source of truth)
        session.geo = geo && (geo.country || geo.city) ? geo : null;
        session.telegram = session.telegram || {};
        sendSessionActivityStartToTelegram({
          sessionId: session.sessionId || sessionId,
          startedAt: session.createdAt,
          geo: session.geo,
          messageCount: Array.isArray(session.messages) ? session.messages.length : 0
        })
          .then((r) => {
            if (r?.ok === true && r?.messageId) {
              session.telegram.activityMessageId = r.messageId;
              session.telegram.activityMessageAt = Date.now();
            }
          })
          .catch(() => {});
      }
    } catch {}
    const inputTypeForLog = req.file ? 'audio' : 'text'; // для логирования (английский)
    const clientDebugEnabled = isClientDebugEnabled(req);
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only) — defensive guard
    if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
      session.debugTrace = { items: [] };
    }

    // 🆕 Sprint 2 / Task 11: per-turn fallback observability summary (local, not stored in session)
    const refFallbackSummary = {
      gateChecked: false,
      gateEligible: false,
      gateBlockedByBoundary: false,
      called: false,
      outputType: null,
      confidence: 0,
      threshold: REF_FALLBACK_CONFIDENCE_THRESHOLD,
      decision: 'not_called',
      finalEffect: null,
      clampApplied: false
    };

    let transcription = '';
    let transcriptionTime = 0;

    if (req.file) {
      const audioFile = new File([req.file.buffer], req.file.originalname, {
        type: req.file.mimetype
      });

      const transcriptionStart = Date.now();
      
      // 🔄 Используем retry для Whisper API
      // Важно: language НЕ передаем — Whisper сам автоопределяет язык речи.
      const whisperPayload = {
        file: audioFile,
        model: 'whisper-1',
        response_format: 'text'
      };
      const whisperResponse = await callOpenAIWithRetry(() => 
        openai.audio.transcriptions.create(whisperPayload), 2, 'Whisper'
      );
      
      transcriptionTime = Date.now() - transcriptionStart;
      // Возвращаем сырой текст транскрипции без каких-либо изменений
      transcription = typeof whisperResponse === 'string'
        ? whisperResponse
        : String(whisperResponse?.text || '');
    } else {
      transcription = req.body.text.trim();
    }

    addMessageToSession(sessionId, 'user', transcription);
    updateInsights(sessionId, transcription);
    
    // 🆕 Sprint V: детекция reference intent в сообщении пользователя (без интерпретации)
    // 🔧 Hotfix: Reference Detector Stabilization (Roadmap v2)
    const refDetectResult = detectReferenceIntent(transcription);
    session.referenceIntent = refDetectResult ? {
      type: refDetectResult.type,
      detectedAt: refDetectResult.detectedAt,
      source: refDetectResult.source
    } : null;
    
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only) — расширенный payload для reference_detected
    if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
      session.debugTrace = { items: [] };
    }
    const rawSnippet = transcription ? transcription.slice(0, 40) : '';
    // Вычисляем normalized независимо от результата детектора (для диагностики)
    const normalizedForTrace = transcription
      ? String(transcription).toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я\s]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
      : '';
    session.debugTrace.items.push({
      type: 'reference_detected',
      at: Date.now(),
      payload: {
        referenceType: refDetectResult?.type || null,
        matchRuleId: refDetectResult?.matchRuleId || null,
        rawTextSnippet: rawSnippet,
        normalizedTextSnippet: normalizedForTrace,
        inputType: inputTypeForLog,
        language: session.clientProfile?.language || null
      }
    });
    
    // 🔧 Hotfix: временный server log для reference_detected
    const shortSid = sessionId ? sessionId.slice(-8) : 'unknown';
    const focusCardId = session.currentFocusCard?.cardId || null;
    const ambiguousFlag = session.referenceAmbiguity?.isAmbiguous === true;
    const clarificationActive = session.clarificationBoundaryActive === true;
    console.log(`[REF] sid=${shortSid} input=${inputTypeForLog} lang=${session.clientProfile?.language || 'null'} raw="${rawSnippet}" norm="${normalizedForTrace}" intent=${refDetectResult?.type || 'null'} rule=${refDetectResult?.matchRuleId || 'null'} amb=${ambiguousFlag} clar=${clarificationActive} focus=${focusCardId}`);

    // 🆕 Sprint 2 / Task 2: fallback LLM классификатор referenceIntent (server-first merge)
    // Fallback вызывается только если:
    // - детектор не сработал (session.referenceIntent === null)
    // - gate shouldUseReferenceFallback(session, transcription) === true
    let fallbackAppliedForPipeline = false;
    let fallbackAppliedReferenceType = null;
    // Cache LLM context pack used for [CTX] (so client debug facts match that turn)
    let llmContextPackForMainCall = null;
    if (session.referenceIntent == null) {
      // gate is checked only when referenceIntent is null (same condition as before)
      refFallbackSummary.gateChecked = true;
      refFallbackSummary.gateBlockedByBoundary =
        session?.referenceAmbiguity?.isAmbiguous === true ||
        session?.clarificationRequired?.isRequired === true ||
        session?.clarificationBoundaryActive === true;

      const gateEligible = shouldUseReferenceFallback(session, transcription) === true;
      refFallbackSummary.gateEligible = gateEligible;

      if (gateEligible === true) {
        const lang = session.clientProfile?.language || null;
        refFallbackSummary.called = true;

        const out = await classifyReferenceIntentFallbackLLM({
          openai,
          text: transcription,
          language: lang
        });

        const thr = REF_FALLBACK_CONFIDENCE_THRESHOLD;
        const referenceType = out?.referenceType ?? null;
        const confidence = (typeof out?.confidence === 'number' && Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1)
          ? out.confidence
          : 0;
        const reasonTag = out?.reasonTag ?? null;
        const isValidType = referenceType === 'single' || referenceType === 'multi' || referenceType === 'unknown';
        const isConfident = isValidType && confidence >= thr;
        const decision = isValidType
          ? (isConfident ? 'applied' : 'ignored_low_confidence')
          : 'ignored_invalid_output';

        // summary fields (observability only)
        refFallbackSummary.outputType = referenceType;
        refFallbackSummary.confidence = confidence;
        refFallbackSummary.threshold = thr;
        refFallbackSummary.decision = decision;

        // server-first merge: применяем только при валидном типе и достаточной уверенности
        if (decision === 'applied') {
          session.referenceIntent = {
            type: referenceType,
            detectedAt: Date.now(),
            source: 'fallback_llm'
          };
          fallbackAppliedForPipeline = true;
          fallbackAppliedReferenceType = referenceType;
        }

        // diagnostics: debugTrace + server log (только когда fallback реально вызван)
        if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
          session.debugTrace = { items: [] };
        }
        session.debugTrace.items.push({
          type: 'reference_fallback',
          at: Date.now(),
          payload: {
            rawTextSnippet: rawSnippet,
            normalizedTextSnippet: normalizedForTrace,
            language: lang,
            gateEligible: true,
            decision,
            threshold: thr,
            confidence,
            referenceType,
            reasonTag: reasonTag ?? null,
            output: {
              referenceType,
              confidence,
              reasonTag: reasonTag ?? null
            }
          }
        });

        const safeRaw = rawSnippet.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        const safeNorm = normalizedForTrace.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        console.log(`[REF_FALLBACK] sid=${shortSid} lang=${lang || 'null'} raw="${safeRaw}" norm="${safeNorm}" out=${referenceType || 'null'} conf=${confidence} thr=${thr} decision=${decision} reason=${reasonTag || 'null'}`);
      } else {
        // gate checked but not eligible -> no classifier call
        refFallbackSummary.decision = 'not_called';
      }
    }
    
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

    // 🆕 Sprint 2 / Task 4: ensure fallback-applied intent enters the same reference pipeline
    // Логируем только при decision=applied (fallbackAppliedForPipeline=true) и только после того,
    // как server pipeline (ambiguity/clarification/binding/shortlist/choiceBoundary) уже отработал.
    if (fallbackAppliedForPipeline === true) {
      const amb = session.referenceAmbiguity?.isAmbiguous === true;
      const clarReq = session.clarificationRequired?.isRequired === true;
      const clarBoundary = session.clarificationBoundaryActive === true;
      const hasProposalBeforeClamp = session.singleReferenceBinding?.hasProposal === true;
      const finalEffect = (amb === true || clarReq === true || clarBoundary === true)
        ? 'clarification'
        : (hasProposalBeforeClamp === true ? 'binding' : 'clarification');

      // Sprint 2 / Task 7 micro-fix: server-first clamp after fallback pipeline
      // Если итоговый эффект — clarification, то не оставляем "эффекты выбора" (binding/choice).
      const clampApplied = finalEffect === 'clarification';
      if (clampApplied === true) {
        // Снять proposal (не трогаем остальные поля singleReferenceBinding)
        if (session.singleReferenceBinding) {
          session.singleReferenceBinding.hasProposal = false;
          session.singleReferenceBinding.proposedCardId = null;
        }
        // Снять "подтверждение выбора"
        if (session.explicitChoiceEvent) {
          session.explicitChoiceEvent.isConfirmed = false;
          if ('cardId' in session.explicitChoiceEvent) {
            session.explicitChoiceEvent.cardId = null;
          }
        }
        // Снять boundary выбора
        if (session.choiceConfirmationBoundary) {
          session.choiceConfirmationBoundary.active = false;
          if ('chosenCardId' in session.choiceConfirmationBoundary) {
            session.choiceConfirmationBoundary.chosenCardId = null;
          }
        }
      }

      // Диагностика: после clamp (чтобы отражать финальное состояние)
      const hasProposal = session.singleReferenceBinding?.hasProposal === true;
      const proposedCardId = session.singleReferenceBinding?.proposedCardId || null;
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
      session.debugTrace.items.push({
        type: 'reference_pipeline_after_fallback',
        at: Date.now(),
        payload: {
          decision: 'applied',
          referenceType: fallbackAppliedReferenceType || null,
          ambiguous: amb,
          clarificationRequired: clarReq,
          clarificationBoundaryActive: clarBoundary,
          hasProposal,
          proposedCardId,
          finalEffect,
          clampApplied
        }
      });
      console.log(`[REF_FALLBACK_PIPELINE] sid=${shortSid} ref=${fallbackAppliedReferenceType || 'null'} amb=${amb ? 1 : 0} clarReq=${clarReq ? 1 : 0} clarBoundary=${clarBoundary ? 1 : 0} bind=${hasProposal ? 1 : 0} bindCard=${proposedCardId || 'null'} finalEffect=${finalEffect} clamp=${clampApplied ? 1 : 0}`);

      // Sprint 2 / Task 11: summary final outcome after pipeline (observability only)
      refFallbackSummary.finalEffect = finalEffect;
      refFallbackSummary.clampApplied = clampApplied === true;
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

    // const totalProps = properties.length; // устарело – переезд на БД
    const detectedLangFromText = (() => {
      const sample = (transcription || req.body.text || '').toString();
      if (/^[\s\S]*[А-Яа-яЁё]/.test(sample)) return 'ru';
      if (/^[\s\S]*[a-zA-Z]/.test(sample)) return 'en';
      return null;
    })();
    const targetLang = (() => {
      // Для аудио приоритет — язык фактически распознанной речи
      if (req.file && detectedLangFromText) return detectedLangFromText;
      const fromReq = (req.body && req.body.lang) ? String(req.body.lang).toLowerCase() : null;
      if (fromReq) return fromReq;
      return detectedLangFromText || 'en';
    })();

    // Для аудио синхронизируем язык профиля с фактически распознанной речью.
    // Для текста сохраняем прежнее поведение (устанавливаем только если ещё не задан).
    if (req.file && detectedLangFromText) {
      session.clientProfile.language = detectedLangFromText;
    } else if (!session.clientProfile.language) {
      session.clientProfile.language = targetLang;
    }

    const baseSystemPrompt = BASE_SYSTEM_PROMPT;
    const metaRepairHint = session?.metaContract?.needsRepairHint === true
      ? {
          role: 'system',
          content: 'Contract reminder: return valid JSON matching the insights_response schema.'
        }
      : null;

    // RMv3 / Sprint 4 / Task 4.1: полный контекст диалога для LLM (user + assistant)
    // ВАЖНО:
    // - порядок сообщений сохраняем хронологический (как в session.messages)
    // - system сообщения и любые служебные/неизвестные роли не включаем
    const dialogMessages = session.messages.filter(
      (msg) => msg && (msg.role === 'user' || msg.role === 'assistant')
    );
    
    const messages = [
      {
        role: 'system',
        content: baseSystemPrompt
      },
      ...(metaRepairHint ? [metaRepairHint] : []),
      ...dialogMessages
    ];

    const gptStart = Date.now();
    
    // 🔄 Используем retry для GPT API
    // RMv3 / Sprint 1: transient LLM Context Pack + [CTX] log (infrastructure only)
    llmContextPackForMainCall = buildLlmContextPack(session, sessionId, 'main');
    logCtx(llmContextPackForMainCall);
    let completion = await callOpenAIWithRetry(() => 
      openai.chat.completions.create({
        messages,
        model: 'gpt-4o-mini',
        temperature: 0.5,
        response_format: { type: 'json_schema', json_schema: INSIGHTS_RESPONSE_SCHEMA },
        stream: false
      }), 2, 'GPT'
    );
    
    const gptTime = Date.now() - gptStart;

    let promptTokens = Number(completion?.usage?.prompt_tokens || 0);
    let completionTokens = Number(completion?.usage?.completion_tokens || 0);
    let totalTokens = Number(completion?.usage?.total_tokens || 0);

    let rawModelContent = String(completion?.choices?.[0]?.message?.content || '').trim();
    let parsedStructured = parseStructuredInsightsResponse(rawModelContent);
    let fallbackUsed = false;

    // Fallback вызывается только при parse fail structured-ответа.
    if (parsedStructured.parseError) {
      fallbackUsed = true;
      const fallbackMessages = [
        ...messages,
        {
          role: 'system',
          content: 'Repair mode: output ONLY valid JSON by insights_response schema.'
        }
      ];
      const fallbackCompletion = await callOpenAIWithRetry(() =>
        openai.chat.completions.create({
          messages: fallbackMessages,
          model: 'gpt-4o-mini',
          temperature: 0,
          response_format: { type: 'json_schema', json_schema: INSIGHTS_RESPONSE_SCHEMA },
          stream: false
        }), 1, 'GPT-Structured-Fallback'
      );
      promptTokens += Number(fallbackCompletion?.usage?.prompt_tokens || 0);
      completionTokens += Number(fallbackCompletion?.usage?.completion_tokens || 0);
      totalTokens += Number(fallbackCompletion?.usage?.total_tokens || 0);
      rawModelContent = String(fallbackCompletion?.choices?.[0]?.message?.content || '').trim();
      parsedStructured = parseStructuredInsightsResponse(rawModelContent);
      completion = fallbackCompletion;
    }

    const assistantText = parsedStructured.assistantText;
    const meta = parsedStructured.meta;
    const metaRaw = parsedStructured.raw;
    const parseError = parsedStructured.parseError;
    try {
      const sid = String(sessionId || '').slice(-8) || 'unknown';
      console.log(`[META_RAW] sid=${sid} ${JSON.stringify(meta ?? null)}`);
    } catch {
      console.log('[META_RAW] failed_to_stringify');
    }
    let botResponse = assistantText || rawModelContent || 'Хорошо, уточню детали и вернусь с лучшими вариантами.';
    // Bonus: после ответа GPT подтверждаем язык сессии по распознанному языку пользовательского текста.
    if (detectedLangFromText) {
      session.clientProfile.language = detectedLangFromText;
    }

    // Patch (outside roadmap): client-visible bind vs spoke measurement (Safari DevTools)
    const spoke = extractSpokeCardId(botResponse);
    const bindHas = session.singleReferenceBinding?.hasProposal === true;
    const bindCardId = session.singleReferenceBinding?.proposedCardId || null;
    const mismatchBindVsSpoke = (bindHas && spoke.cardId && spoke.cardId !== bindCardId) ? 1 : 0;
    if (mismatchBindVsSpoke === 1) {
      const rule = getLatestMatchRuleId(session);
      console.log(`[MISMATCH] sid=${String(sessionId || '').slice(-8) || 'unknown'} bind=${bindCardId || 'null'} spoke=${spoke.cardId || 'null'} focus=${session.currentFocusCard?.cardId || 'null'} lastShown=${session.lastShown?.cardId || 'null'} rule=${rule || 'null'}`);
    }

    let extractionReport = {
      metaPresent: !!metaRaw,
      parseError: parseError === true,
      validationError: false,
      updatesApplied: false,
      fallbackUsed
    };
    let extractionInvalidFields = [];
    // META обработка: единый парсинг произвольного ---META--- блока от модели
    try {
      if (meta && typeof meta === 'object') {
        const profilePatches = [];
        if (meta.clientProfileDelta && typeof meta.clientProfileDelta === 'object') profilePatches.push(meta.clientProfileDelta);
        if (meta.clientProfile && typeof meta.clientProfile === 'object') profilePatches.push(meta.clientProfile);
        for (const patch of profilePatches) {
          session.clientProfile = mergeClientProfile(session.clientProfile, patch);
        }
        mapClientProfileToInsights(session.clientProfile, session.insights);
        const applyResult = applyMetaInsightsToSession(session, meta);
        extractionInvalidFields = Array.isArray(applyResult?.invalidFields) ? applyResult.invalidFields : [];
        extractionReport.validationError = Array.isArray(applyResult?.invalidFields) && applyResult.invalidFields.length > 0;
        extractionReport.updatesApplied = applyResult?.applied === true;
        session.metaContract = {
          ...(session.metaContract || {}),
          needsRepairHint: extractionReport.parseError || extractionReport.validationError,
          lastError: extractionReport.parseError ? 'meta_parse_error' : (extractionReport.validationError ? 'meta_validation_error' : null),
          lastMetaRaw: metaRaw || null,
          lastUpdatedAt: new Date().toISOString()
        };
        const profileLog = {
          language: session.clientProfile.language,
          location: session.clientProfile.location,
          budgetMin: session.clientProfile.budgetMin,
          budgetMax: session.clientProfile.budgetMax,
          purpose: session.clientProfile.purpose,
          propertyType: session.clientProfile.propertyType,
          urgency: session.clientProfile.urgency
        };
        console.log(`🧩 Профиль/инсайты обновлены [${String(sessionId).slice(-8)}]: ${JSON.stringify(profileLog)}`);
      } else {
        session.metaContract = {
          ...(session.metaContract || {}),
          needsRepairHint: true,
          lastError: extractionReport.parseError ? 'meta_parse_error' : 'meta_missing',
          lastMetaRaw: metaRaw || null,
          lastUpdatedAt: new Date().toISOString()
        };
      }
    } catch (e) {
      console.log('ℹ️ META отсутствует или невалидна, продолжаем без обновления профиля');
      extractionReport.validationError = true;
      session.metaContract = {
        ...(session.metaContract || {}),
        needsRepairHint: true,
        lastError: 'meta_processing_exception',
        lastMetaRaw: metaRaw || null,
        lastUpdatedAt: new Date().toISOString()
      };
    }
    updateExtractionMetrics(session, extractionReport);

    // 🔎 Детектор намерения/вариантов
    const { show, variants } = detectCardIntent(transcription);
    const schedule = detectScheduleIntent(transcription);

    // UI extras and cards container
    let cards = [];
    let ui = undefined;
    // (удалено) парсинг inline lead из текста и сигналы формы
    // прогресс не используется как гейт выдачи контента

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
        const { ranked } = await getRankedProperties(session.insights);
        const hasHard = hasHardFilters(session.insights);
        const source = ranked.length ? ranked : (hasHard ? [] : await getAllNormalizedProperties());
        pool = source.map(p => p.id);
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
      }
    }

    // RMv3 / Sprint 4 / Task 4.4: demo-only словесный выбор объекта → тот же button-flow (через /interaction select)
    // ВАЖНО:
    // - используем lastShown (приоритет) или currentFocusCard
    // - если нет cardId → ничего не делаем (no-guessing)
    // - не меняем server-facts здесь: запускаем тот же путь, что и кнопка "Выбрать"
    try {
      if (show !== true && detectVerbalSelectIntent(transcription) === true) {
        const chosenCardId =
          (session?.lastShown && session.lastShown.cardId) ? String(session.lastShown.cardId) :
          (session?.currentFocusCard && session.currentFocusCard.cardId) ? String(session.currentFocusCard.cardId) :
          null;
        if (chosenCardId) {
          // Короткое подтверждение (без вопросов/объяснений)
          botResponse = 'Отлично, зафиксировал выбор.';
          // UI-совместимость: фронт вызывает sendCardInteraction('select', id) → включится тот же handoff UX
          ui = { ...(ui || {}), autoSelectCardId: chosenCardId };
        }
      }
    } catch {}

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
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens
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
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens
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

    // 🆕 Sprint 2 / Task 11: one summary per user turn (only if fallback was considered)
    if (refFallbackSummary.gateChecked === true || refFallbackSummary.called === true) {
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
      session.debugTrace.items.push({
        type: 'reference_fallback_summary',
        at: Date.now(),
        payload: {
          gateChecked: refFallbackSummary.gateChecked === true,
          gateEligible: refFallbackSummary.gateEligible === true,
          gateBlockedByBoundary: refFallbackSummary.gateBlockedByBoundary === true,
          called: refFallbackSummary.called === true,
          outputType: refFallbackSummary.outputType ?? null,
          confidence: typeof refFallbackSummary.confidence === 'number' ? refFallbackSummary.confidence : 0,
          threshold: typeof refFallbackSummary.threshold === 'number' ? refFallbackSummary.threshold : REF_FALLBACK_CONFIDENCE_THRESHOLD,
          decision: refFallbackSummary.decision,
          finalEffect: refFallbackSummary.finalEffect ?? null,
          clampApplied: refFallbackSummary.clampApplied === true
        }
      });
      console.log(
        `[REF_FALLBACK_SUMMARY] sid=${shortSid}` +
        ` gateChecked=${refFallbackSummary.gateChecked ? 1 : 0}` +
        ` eligible=${refFallbackSummary.gateEligible ? 1 : 0}` +
        ` blockedByBoundary=${refFallbackSummary.gateBlockedByBoundary ? 1 : 0}` +
        ` called=${refFallbackSummary.called ? 1 : 0}` +
        ` out=${refFallbackSummary.outputType || 'null'}` +
        ` conf=${typeof refFallbackSummary.confidence === 'number' ? refFallbackSummary.confidence : 0}` +
        ` thr=${typeof refFallbackSummary.threshold === 'number' ? refFallbackSummary.threshold : REF_FALLBACK_CONFIDENCE_THRESHOLD}` +
        ` decision=${refFallbackSummary.decision}` +
        ` finalEffect=${refFallbackSummary.finalEffect || 'null'}` +
        ` clamp=${refFallbackSummary.clampApplied ? 1 : 0}`
      );
    }

    const { totalMatches } = await getRankedProperties(session.insights);

    const responsePayload = {
      response: botResponse,
      transcription,
      sessionId,
      messageCount: session.messages.length,
      inputType,
      clientProfile: session.clientProfile,
      stage: session.stage,
      role: session.role, // 🆕 Sprint I: server-side role
      insights: session.insights, // 🆕 Теперь содержит все 9 параметров
      extractionStatus: {
        metaPresent: extractionReport.metaPresent === true,
        parseError: extractionReport.parseError === true,
        validationError: extractionReport.validationError === true,
        updatesApplied: extractionReport.updatesApplied === true,
        fallbackUsed: extractionReport.fallbackUsed === true,
        invalidFields: extractionInvalidFields
      },
      totalMatches,
      // ui пропускается, если undefined; cards может быть пустым массивом
      cards: DISABLE_SERVER_UI ? [] : cards,
      ui: DISABLE_SERVER_UI ? undefined : ui,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens
      },
      timing: {
        transcription: transcriptionTime,
        gpt: gptTime,
        total: totalTime
      }
    };

    // Patch (outside roadmap): Browser-visible compact debug (only under exact gate)
    if (clientDebugEnabled === true) {
      const matchRuleId = getLatestMatchRuleId(session);
      const pack = llmContextPackForMainCall || buildLlmContextPack(session, sessionId, 'main');
      const factsIds = Array.isArray(pack?.facts?.factsCardIds) ? pack.facts.factsCardIds.filter(Boolean) : [];
      const allowedFactsSnapshot = pack?.facts?.allowedFactsSnapshot ?? null;
      const allowedFacts = (allowedFactsSnapshot && typeof allowedFactsSnapshot === 'object' && Object.keys(allowedFactsSnapshot).length > 0) ? 1 : 0;

      responsePayload.debug = {
        deploy: getDeployShortOrNull(),
        sid: String(sessionId || '').slice(-8) || 'unknown',
        ts: Date.now(),
        input: {
          type: inputTypeForLog,
          raw: clip(transcription, 80),
          norm: clip(normalizeForClientDebug(transcription), 80)
        },
        ref: {
          type: session.referenceIntent?.type ?? null,
          rule: matchRuleId
        },
        ui: {
          focus: session.currentFocusCard?.cardId || null,
          lastShown: session.lastShown?.cardId || null,
          lastFocus: session.lastFocusSnapshot?.cardId || null,
          slider: session.sliderContext?.active === true ? 1 : 0
        },
        bind: {
          has: bindHas ? 1 : 0,
          cardId: bindCardId,
          basis: session.singleReferenceBinding?.basis ?? null
        },
        facts: {
          ids: factsIds,
          allowed: allowedFacts,
          count: factsIds.length
        },
        spoke: {
          cardId: spoke.cardId,
          confidence: spoke.confidence
        },
        mismatch: {
          bindVsSpoke: mismatchBindVsSpoke
        }
      };
    }

    res.json(responsePayload);

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
  // RMv3: best-effort Telegram final update on explicit clear
  try {
    const session = sessions.get(sessionId);
    const messageId = session?.telegram?.activityMessageId || null;
    if (session && messageId) {
      updateSessionActivityFinalToTelegram({
        messageId,
        sessionId: session?.sessionId || sessionId,
        startedAt: session?.createdAt ?? null,
        lastActivityAt: session?.lastActivity ?? null,
        durationMs: (typeof session?.createdAt === 'number' && typeof session?.lastActivity === 'number')
          ? Math.max(0, session.lastActivity - session.createdAt)
          : null,
        geo: session?.geo || null,
        messageCount: Array.isArray(session?.messages) ? session.messages.length : null,
        sliderReached: !!(session?.sliderContext && session.sliderContext.updatedAt),
        insights: session?.insights || null,
        cardsShownCount: session?.shownSet ? (session.shownSet.size || 0) : null,
        likesCount: Array.isArray(session?.liked) ? session.liked.length : null,
        selectedCardId: session?.selectedCard?.cardId || null,
        handoffActive: session?.handoff?.shownAt ? true : (session?.handoff?.active === true),
        handoffCanceled: session?.handoff?.canceled === true
      }).catch(() => {});
    }
  } catch {}
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
const getSessionInfo = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    const { totalMatches } = await getRankedProperties(session.insights || {});

    res.json({
      sessionId,
      clientProfile: session.clientProfile,
      stage: session.stage,
      role: session.role, // 🆕 Sprint I: server-side role
      insights: session.insights, // 🆕 Теперь содержит все 9 параметров
      totalMatches,
      lastCandidates: Array.isArray(session.lastCandidates) ? session.lastCandidates : [],
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
  } catch (e) {
    console.error('getSessionInfo error:', e);
    res.status(500).json({ error: 'internal' });
  }
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
  triggerCompletion,
  shouldUseReferenceFallback
};

// ---------- Взаимодействия (like / next) ----------
async function handleInteraction(req, res) {
  try {
    const { action, variantId, sessionId } = req.body || {};
    if (!action || !sessionId) return res.status(400).json({ error: 'action и sessionId обязательны' });
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
    const clientDebugEnabled = isClientDebugEnabled(req);
    const withDebug = (payload) => {
      if (clientDebugEnabled !== true) return payload;
      return {
        ...payload,
        debug: {
          deploy: getDeployShortOrNull(),
          sid: String(sessionId || '').slice(-8) || 'unknown',
          ts: Date.now(),
          action: String(action),
          ui: {
            focus: session.currentFocusCard?.cardId || null,
            lastShown: session.lastShown?.cardId || null,
            slider: session.sliderContext?.active === true ? 1 : 0
          }
        }
      };
    };
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
      const { ranked } = await getRankedProperties(session.insights);
      const hasHard = hasHardFilters(session.insights);
      // Если по hard-filter нет совпадений — пул остаётся пустым
      const pool = ranked.length ? ranked : (hasHard ? [] : await getAllNormalizedProperties());
      session.lastCandidates = pool.map(p => p.id);
      session.candidateIndex = 0;
    } else if (session.lastCandidates.length < 2 && !hasHardFilters(session.insights)) {
      // Гарантируем минимум 2 кандидата, расширив до всей базы (без дубликатов)
      const set = new Set(session.lastCandidates);
      const all = await getAllNormalizedProperties();
      for (const p of all) { if (!set.has(p.id)) set.add(p.id); }
      session.lastCandidates = Array.from(set);
      if (!Number.isInteger(session.candidateIndex)) session.candidateIndex = 0;
    }
    const { totalMatches } = await getRankedProperties(session.insights);

    if (action === 'show') {
      // Первый показ выбранной карточки: только карточка/ID, без backend-комментария
      const list = session.lastCandidates || [];
      const hardFilteredMode = hasHardFilters(session.insights);
      // Если фронт прислал variantId — используем его, иначе возьмём текущий индекс/первый
      let id = variantId;
      if (!id) {
        if (hardFilteredMode && list.length === 0) {
          return res.json(withDebug({ ok: true, cardId: null, card: null, totalMatches, role: session.role }));
        }
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
      return res.json(withDebug({ ok: true, cardId: p.id, card, totalMatches, role: session.role })); // 🆕 Sprint I: server-side role
    }

    if (action === 'next') {
      // Перейти к следующему подходящему объекту
      const list = session.lastCandidates || [];
      const len = list.length;
      if (!len) {
        if (hasHardFilters(session.insights)) {
          return res.json(withDebug({ ok: true, cardId: null, card: null, totalMatches, role: session.role }));
        }
        // крайний случай: вернём первый из базы
        const all = await getAllNormalizedProperties();
        const p = all[0];
        if (!p) return res.status(404).json({ error: 'Карточка не найдена' });
        const card = formatCardForClient(req, p);
        return res.json(withDebug({ ok: true, cardId: p.id, card, totalMatches, role: session.role })); // 🆕 Sprint I: server-side role
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
      return res.json(withDebug({ ok: true, cardId: p.id, card, totalMatches, role: session.role })); // 🆕 Sprint I: server-side role
    }

    if (action === 'like') {
      // Сохраним лайк для аналитики (минимально)
      session.liked = session.liked || [];
      if (variantId) session.liked.push(variantId);
      const count = session.liked.length;
      const msg = `Супер, сохранил! Могу предложить записаться на просмотр или показать ещё варианты. Что выберем? (понравилось: ${count})`;
      return res.json(withDebug({ ok: true, assistantMessage: msg, totalMatches, role: session.role })); // 🆕 Sprint I: server-side role
    }

    // RMv3 / Sprint 1 / Task 1: факт выбора карточки пользователем (UI "Выбрать") — server-first
    // ВАЖНО:
    // - не запускает handoff
    // - не меняет role/stage
    // - не трогает LLM
    if (action === 'select') {
      const cardId = typeof variantId === 'string' ? variantId.trim() : null;
      if (!cardId) {
        return res.status(400).json({ error: 'variantId обязателен для select' });
      }
      if (!session.selectedCard) {
        session.selectedCard = { cardId: null, selectedAt: null };
      }
      const now = Date.now();
      session.selectedCard.cardId = cardId;
      session.selectedCard.selectedAt = now;
      // RMv3 / Sprint 2 / Task 2.1: фиксируем факт "handoff активирован/показан" на сервере
      if (!session.handoff) {
        session.handoff = { active: false, shownAt: null, cardId: null, canceled: false, canceledAt: null };
      }
      session.handoff.active = true;
      session.handoff.shownAt = now;
      session.handoff.cardId = session.selectedCard.cardId;
      // при новом handoff сбрасываем cancel-факт (если был)
      session.handoff.canceled = false;
      session.handoff.canceledAt = null;
      return res.json(withDebug({ ok: true, totalMatches, role: session.role }));
    }

    // RMv3 / Sprint 2 / Task 2.4: server-fact cancel из in-dialog lead block
    // ВАЖНО:
    // - не трогает role/stage
    // - не вызывает LLM
    // - не трогает lead-flow
    if (action === 'handoff_cancel') {
      const now = Date.now();
      if (!session.handoff) {
        session.handoff = { active: false, shownAt: null, cardId: null, canceled: false, canceledAt: null };
      }
      session.handoff.active = false;
      session.handoff.canceled = true;
      session.handoff.canceledAt = now;
      // Полная отмена выбора: сбрасываем выбранную карточку и cardId в handoff
      if (!session.selectedCard) {
        session.selectedCard = { cardId: null, selectedAt: null };
      }
      session.selectedCard.cardId = null;
      session.selectedCard.selectedAt = null;
      session.handoff.cardId = null;
      return res.json(withDebug({ ok: true, totalMatches, role: session.role }));
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
      return res.json(withDebug({ ok: true, totalMatches, role: session.role })); // 🆕 Sprint I: server-side role
    }

    // 🆕 Sprint IV: обработка события ui_slider_started для фиксации активности slider
    if (action === 'ui_slider_started') {
      if (!session.sliderContext) {
        session.sliderContext = { active: false, updatedAt: null };
      }
      session.sliderContext.active = true;
      session.sliderContext.updatedAt = Date.now();
      console.log(`📱 [Sprint IV] Slider стал активным (сессия ${sessionId.slice(-8)})`);
      return res.json(withDebug({ ok: true, totalMatches, role: session.role }));
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
      
      return res.json(withDebug({ ok: true, totalMatches, role: session.role })); // 🆕 Sprint I: server-side role
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
      return res.json(withDebug({ ok: true, totalMatches, role: session.role }));
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
    return res.json(withDebug({ ok: true, totalMatches, role: session.role }));
  } catch (e) {
    console.error('interaction error:', e);
    res.status(500).json({ error: 'internal' });
  }
}
