import { INSIGHT_FIELDS, recalcInsightsProgress, sanitizeInsightValue } from './insightsProfilePolicy.js';
import { splitLocationTargets } from './audioPropertySearchUtils.js';
import { upsertSessionLog } from './sessionLogger.js';

export const applyMetaInsightsToSession = (session, meta, userUtterance = '') => {
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
    const isUAH = /\b(грн|гривн|гривня|гривні|гривен|гривень)\b/.test(raw) || /₴/.test(raw);
    const uahToUsdRate = Number(process.env.UAH_TO_USD_RATE || process.env.UAH_TO_USD || 0.024);
    const toUsdIfNeeded = (amount) => {
      if (!Number.isFinite(amount)) return null;
      if (!isUAH) return Math.round(amount);
      const rate = Number.isFinite(uahToUsdRate) && uahToUsdRate > 0 ? uahToUsdRate : 0.024;
      return Math.round(amount * rate);
    };
    const normalizeNum = (v) => Number(String(v).replace(',', '.'));
    const thousandBefore = raw.match(/(?:тыс|тысяч|тис\.?)\s*(\d+(?:[.,]\d+)?)/i);
    if (thousandBefore) {
      const n = normalizeNum(thousandBefore[1]);
      if (Number.isFinite(n)) return toUsdIfNeeded(n * 1000);
    }
    const thousandAfter = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:тыс|тысяч|тис\.?)\b/i);
    if (thousandAfter) {
      const n = normalizeNum(thousandAfter[1]);
      if (Number.isFinite(n)) return toUsdIfNeeded(n * 1000);
    }
    const compact = raw.replace(/\s+/g, '');
    const match = compact.match(/^(\d+(?:[.,]\d+)?)(k|к|тыс|тысяч|тис|м|млн|миллион|миллиона|миллионов)?$/i);
    if (match) {
      const base = Number(String(match[1]).replace(',', '.'));
      if (!Number.isFinite(base)) return null;
      const suffix = String(match[2] || '').toLowerCase();
      if (['k', 'к', 'тыс', 'тысяч', 'тис'].includes(suffix)) return toUsdIfNeeded(base * 1000);
      if (['м', 'млн', 'миллион', 'миллиона', 'миллионов'].includes(suffix)) return toUsdIfNeeded(base * 1000000);
      return toUsdIfNeeded(base);
    }
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? toUsdIfNeeded(parsed) : null;
  };

  const detectPriceSemantics = (text) => {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) return 'single_or_upper';
    if (/\b(от|from)\b[\s\S]{0,30}\b(до|to)\b/.test(raw)) return 'range';
    if (/\b\d+\s*[-–—]\s*\d+\b/.test(raw)) return 'range';
    if (/\b(в\s*диапазоне|range|between)\b/.test(raw)) return 'range';
    if (/\b(до|не\s*более|макс(?:имум)?|up\s*to|budget)\b/.test(raw)) return 'upper';
    if (/\b(от|начиная\s+с|не\s*ниже|min(?:imum)?|from)\b/.test(raw)) return 'lower';
    return 'single_or_upper';
  };
  const detectAreaSemantics = (text) => {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) return 'single_or_upper';
    if (/\b(от|from)\b[\s\S]{0,30}\b(до|to)\b/.test(raw)) return 'range';
    if (/\b\d+\s*[-–—]\s*\d+\b/.test(raw)) return 'range';
    if (/\b(в\s*диапазоне|range|between)\b/.test(raw)) return 'range';
    if (/\b(до|не\s*более|макс(?:имум)?|up\s*to)\b/.test(raw)) return 'upper';
    if (/\b(от|начиная\s+с|не\s*ниже|min(?:imum)?|from)\b/.test(raw)) return 'lower';
    return 'single_or_upper';
  };

  const parseRoomsValue = (value) => {
    if (value === null || value === undefined) return null;
    const detectRoomBands = (textLike) => {
      const text = String(textLike || '').trim().toLowerCase();
      if (!text) return [];
      const found = new Set();
      if (/(5\+|5plus|\bпят(и|ь)\b|\bпятикомнат|\b5\s*комн|\bfive\b)/i.test(text)) found.add(5);
      if (/(4\+|4plus|\bчетыр(е|ё|ех|ёх)\b|\bчетырехкомнат|\bчетырёхкомнат|\b4\s*комн|\bfour\b)/i.test(text)) found.add(4);
      if (/(тр(е|ё)шка|\bтрехкомнат|\bтрёхкомнат|\b3\s*комн|\bthree\b|\bтр(е|ё)х\b)/i.test(text)) found.add(3);
      if (/(двушка|\bдвухкомнат|\b2\s*комн|\btwo\b|\bдвух\b|\bдву\b)/i.test(text)) found.add(2);
      if (/(однушка|\bоднокомнат|\b1\s*комн|\bone\b|\bодн\b|studio|студия|смарт)/i.test(text)) found.add(1);
      return Array.from(found).sort((a, b) => a - b);
    };
    const parseOne = (item) => {
      if (item === null || item === undefined) return null;
      if (typeof item === 'number' && Number.isFinite(item)) return Math.round(item);
      const raw = String(item).trim().toLowerCase();
      if (!raw) return null;
      const detected = detectRoomBands(raw);
      if (detected.length === 1) return detected[0];
      if (detected.length > 1) return detected;
      const numeric = raw.match(/\d+/);
      if (!numeric) return null;
      const parsed = Number(numeric[0]);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const tokens = Array.isArray(value)
      ? value
      : String(value).split(/\s*(?:,|\/|\\|\||\s+или\s+|\s+либо\s+|;|&)\s*/i);
    const uniq = [];
    for (const token of tokens) {
      const parsed = parseOne(token);
      if (parsed == null) continue;
      if (Array.isArray(parsed)) {
        parsed.forEach((value) => {
          if (!uniq.includes(value)) uniq.push(value);
        });
      } else if (!uniq.includes(parsed)) uniq.push(parsed);
    }
    if (!uniq.length) return null;
    return uniq.length === 1 ? uniq[0] : uniq;
  };

  const parseDistrictValue = (value) => {
    if (value === null || value === undefined) return null;
    const tokens = splitLocationTargets(value);
    if (!tokens.length) return null;
    const uniq = [];
    for (const token of tokens) {
      const cleaned = sanitizeInsightValue(token);
      if (!cleaned) continue;
      if (!uniq.includes(cleaned)) uniq.push(cleaned);
    }
    if (!uniq.length) return null;
    return uniq.length === 1 ? uniq[0] : uniq;
  };

  const parseFloorNumber = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (/(не\s*перв|not\s*first|не\s*послед|не\s*остан|not\s*last|высок(ий|ого)|high|средн(ий|его)|middle|mid|низк(ий|ого)|low)/i.test(raw)) {
      return raw;
    }
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
    if (/(rent|lease|аренд|оренд|снять)/i.test(raw)) return 'rent';
    return null;
  };
  const normalizeType = (value) => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (/(apartment|flat|квартир|апартамент|апарты)/i.test(raw)) return 'apartment';
    if (/(house|villa|home|дом|вилл)/i.test(raw)) return 'house';
    if (/(land|plot|участок|земля)/i.test(raw)) return 'land';
    if (/(commercial|office|retail|warehouse|коммер|офис|склад|нежил)/i.test(raw)) return 'commercial';
    if (raw === 'apartment' || raw === 'house' || raw === 'land' || raw === 'commercial') return raw;
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

  const parseFeatures = (value) => {
    if (value === null || value === undefined) return null;
    const out = [];
    const pushToken = (token) => {
      const normalized = String(token || '').trim().toLowerCase();
      if (!normalized) return;
      if (!out.includes(normalized)) out.push(normalized);
    };
    if (Array.isArray(value)) {
      value.forEach((item) => pushToken(item));
    } else {
      const raw = String(value || '').trim();
      if (!raw) return null;
      raw.split(/[,\n;|]/).forEach((item) => pushToken(item));
      // heuristic extraction from details-like sentence
      const map = [
        ['terrace', /(terrace|терасс|террас)/i],
        ['balcony', /(balcony|балкон)/i],
        ['balcony', /(лоджи|лоджія|loggia)/i],
        ['parking', /(parking|паркинг|парковк|паркомест|парко ?місц)/i],
        ['pool', /(pool|бассейн)/i],
        ['sea view', /(sea view|вид на море)/i],
        ['high floor', /(high floor|высокий этаж)/i],
        ['middle floor', /(middle floor|средний этаж)/i],
        ['low floor', /(low floor|низкий этаж)/i]
      ];
      map.forEach(([label, re]) => { if (re.test(raw)) pushToken(label); });
    }
    return out.length ? out : null;
  };

  const parseFloorBooleanFlag = (value, kind = 'not_first') => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (['true', '1', 'yes', 'y', 'да'].includes(raw)) return true;
    if (['false', '0', 'no', 'n', 'нет'].includes(raw)) return false;
    if (kind === 'not_first') {
      if (/(не\s*перв|not\s*first)/i.test(raw)) return true;
    } else {
      if (/(не\s*послед|не\s*остан|not\s*last)/i.test(raw)) return true;
    }
    return null;
  };

  const invalidFields = [];
  let appliedCount = 0;
  const enableRewrite = process.env.ENABLE_AI_FILTER_REWRITE === 'true';
  const CORE_FIELDS = ['type', 'operation'];

  for (const field of INSIGHT_FIELDS) {
    const incoming = sourceInsights[field];
    if (incoming === undefined) continue;
    let nextValue = null;
    if (field === 'budget') nextValue = parseBudgetNumber(incoming);
    else if (field === 'budgetMax') nextValue = parseBudgetNumber(incoming);
    else if (field === 'district') nextValue = parseDistrictValue(incoming);
    else if (field === 'location') nextValue = parseDistrictValue(incoming);
    else if (field === 'rooms') nextValue = parseRoomsValue(incoming);
    else if (field === 'operation') nextValue = normalizeOperation(incoming);
    else if (field === 'type') nextValue = normalizeType(incoming);
    else if (field === 'area') nextValue = parseNumeric(incoming);
    else if (field === 'areaMin') nextValue = parseNumeric(incoming);
    else if (field === 'areaMax') nextValue = parseNumeric(incoming);
    else if (field === 'landArea') nextValue = parseNumeric(incoming);
    else if (field === 'landAreaMin') nextValue = parseNumeric(incoming);
    else if (field === 'landAreaMax') nextValue = parseNumeric(incoming);
    else if (field === 'floor') nextValue = parseFloorNumber(incoming);
    else if (field === 'floorNotFirst') nextValue = parseFloorBooleanFlag(incoming, 'not_first');
    else if (field === 'floorNotLast') nextValue = parseFloorBooleanFlag(incoming, 'not_last');
    else if (field === 'features') nextValue = parseFeatures(incoming);
    else nextValue = sanitizeInsightValue(incoming);
    
    const isEmptyArray = Array.isArray(nextValue) && nextValue.length === 0;
    const isNullish = nextValue === null || nextValue === undefined || isEmptyArray || (!Array.isArray(nextValue) && String(nextValue).trim() === '');
    const isCore = CORE_FIELDS.includes(field);

    if (enableRewrite) {
      if (isCore) {
        // Write-once policy for core fields: prevent AI from rewriting or clearing them once set
        if (session.insights[field] != null && String(session.insights[field]).trim() !== '') {
          continue;
        } else {
          if (!isNullish) {
            session.insights[field] = nextValue;
            appliedCount += 1;
          }
        }
      } else {
        // Flexible fields: allow AI to explicitly clear them using null or empty array
        if (isNullish) {
          if (session.insights[field] !== null) {
            session.insights[field] = null;
            appliedCount += 1;
          }
        } else {
          session.insights[field] = nextValue;
          appliedCount += 1;
        }
      }
    } else {
      // Legacy strict logic
      if (isNullish) {
        invalidFields.push(field);
        continue;
      }
      session.insights[field] = nextValue;
      appliedCount += 1;
    }
  }
  // price policy v1 (AI -> execution semantics source fields):
  // - single amount / upper intent => budgetMax only
  // - explicit range => budget(lower) + budgetMax(upper)
  // - lower-only => keep in budget, do not auto-populate budgetMax
  // This block also resolves stale budget/budgetMax conflicts from previous turns.
  try {
    const incomingHasBudget = Object.prototype.hasOwnProperty.call(sourceInsights, 'budget');
    const incomingHasBudgetMax = Object.prototype.hasOwnProperty.call(sourceInsights, 'budgetMax');
    const incomingBudget = incomingHasBudget ? parseBudgetNumber(sourceInsights?.budget) : null;
    const incomingBudgetMax = incomingHasBudgetMax ? parseBudgetNumber(sourceInsights?.budgetMax) : null;
    const semantics = detectPriceSemantics(userUtterance);

    if (semantics === 'range') {
      if (incomingBudget != null && incomingBudgetMax != null) {
        const low = Math.min(incomingBudget, incomingBudgetMax);
        const high = Math.max(incomingBudget, incomingBudgetMax);
        session.insights.budget = low;
        session.insights.budgetMax = high;
      } else if (incomingBudgetMax != null) {
        session.insights.budget = null;
        session.insights.budgetMax = incomingBudgetMax;
      } else if (incomingBudget != null) {
        session.insights.budget = null;
        session.insights.budgetMax = incomingBudget;
      }
    } else if (semantics === 'upper') {
      const upper = incomingBudgetMax ?? incomingBudget;
      if (upper != null) {
        session.insights.budget = null;
        session.insights.budgetMax = upper;
      }
    } else if (semantics === 'lower') {
      const lower = incomingBudget ?? incomingBudgetMax;
      if (lower != null) {
        session.insights.budget = lower;
        session.insights.budgetMax = null;
      }
    } else {
      // single_or_upper (default for ambiguous single value)
      if (incomingBudget != null && incomingBudgetMax != null) {
        if (incomingBudget < incomingBudgetMax) {
          session.insights.budget = incomingBudget;
          session.insights.budgetMax = incomingBudgetMax;
        } else {
          session.insights.budget = null;
          session.insights.budgetMax = Math.max(incomingBudget, incomingBudgetMax);
        }
      } else if (incomingBudgetMax != null) {
        session.insights.budget = null;
        session.insights.budgetMax = incomingBudgetMax;
      } else if (incomingBudget != null) {
        session.insights.budget = null;
        session.insights.budgetMax = incomingBudget;
      }
    }
  } catch {}
  // area policy v1 (AI -> execution semantics source fields):
  // - "до X м²" / "X м²" => upper bound (areaMax)
  // - explicit range => areaMin + areaMax
  // - "от X м²" => areaMin only
  // This also prevents stale/legacy areaMin from acting as default for single-area mentions.
  try {
    const incomingHasArea = Object.prototype.hasOwnProperty.call(sourceInsights, 'area');
    const incomingHasAreaMin = Object.prototype.hasOwnProperty.call(sourceInsights, 'areaMin');
    const incomingHasAreaMax = Object.prototype.hasOwnProperty.call(sourceInsights, 'areaMax');
    const incomingArea = incomingHasArea ? parseNumeric(sourceInsights?.area) : null;
    const incomingAreaMin = incomingHasAreaMin ? parseNumeric(sourceInsights?.areaMin) : null;
    const incomingAreaMax = incomingHasAreaMax ? parseNumeric(sourceInsights?.areaMax) : null;
    const areaSemantics = detectAreaSemantics(userUtterance);

    if (areaSemantics === 'range') {
      if (incomingAreaMin != null && incomingAreaMax != null) {
        const low = Math.min(incomingAreaMin, incomingAreaMax);
        const high = Math.max(incomingAreaMin, incomingAreaMax);
        session.insights.areaMin = low;
        session.insights.areaMax = high;
      } else if (incomingArea != null && incomingAreaMax != null) {
        session.insights.areaMin = Math.min(incomingArea, incomingAreaMax);
        session.insights.areaMax = Math.max(incomingArea, incomingAreaMax);
      } else if (incomingAreaMin != null && incomingArea != null) {
        session.insights.areaMin = Math.min(incomingAreaMin, incomingArea);
        session.insights.areaMax = Math.max(incomingAreaMin, incomingArea);
      } else if (incomingAreaMax != null) {
        session.insights.areaMin = null;
        session.insights.areaMax = incomingAreaMax;
      } else if (incomingArea != null) {
        session.insights.areaMin = null;
        session.insights.areaMax = incomingArea;
      }
    } else if (areaSemantics === 'upper') {
      const upper = incomingAreaMax ?? incomingArea ?? incomingAreaMin;
      if (upper != null) {
        session.insights.areaMin = null;
        session.insights.areaMax = upper;
      }
    } else if (areaSemantics === 'lower') {
      const lower = incomingAreaMin ?? incomingArea ?? incomingAreaMax;
      if (lower != null) {
        session.insights.areaMin = lower;
        session.insights.areaMax = null;
      }
    } else {
      // single_or_upper default
      if (incomingAreaMin != null && incomingAreaMax != null) {
        session.insights.areaMin = Math.min(incomingAreaMin, incomingAreaMax);
        session.insights.areaMax = Math.max(incomingAreaMin, incomingAreaMax);
      } else {
        const upper = incomingAreaMax ?? incomingArea ?? incomingAreaMin;
        if (upper != null) {
          session.insights.areaMin = null;
          session.insights.areaMax = upper;
        }
      }
    }
  } catch {}
  // floor flags fallback: if model encoded constraint in floor text, convert to structured flags.
  if (session.insights.floorNotFirst == null && typeof session.insights.floor === 'string') {
    const derived = parseFloorBooleanFlag(session.insights.floor, 'not_first');
    if (derived === true) session.insights.floorNotFirst = true;
  }
  if (session.insights.floorNotLast == null && typeof session.insights.floor === 'string') {
    const derived = parseFloorBooleanFlag(session.insights.floor, 'not_last');
    if (derived === true) session.insights.floorNotLast = true;
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
