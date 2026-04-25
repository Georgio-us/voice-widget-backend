const toText = (v) => String(v ?? '').trim();

const normalizeText = (v) =>
  String(v || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseFirstInt = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = String(v).replace(/\s/g, '');
  const m = s.match(/-?\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
};

const parseMaxInt = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = String(v).replace(/\s/g, '');
  const nums = (s.match(/\d+/g) || []).map((x) => Number.parseInt(x, 10)).filter(Number.isFinite);
  if (!nums.length) return null;
  return Math.max(...nums);
};

const normalizeOperation = (v) => {
  const s = normalizeText(v);
  if (!s) return null;
  if (/(rent|lease|alquil|аренд|снять|найм)/.test(s)) return 'rent';
  if (/(sale|buy|purchase|compra|покуп|купить|приобр|инвест)/.test(s)) return 'sale';
  return null;
};

const normalizePropertyType = (v) => {
  const s = normalizeText(v);
  if (!s) return null;
  const map = [
    [/\b(apartment|apartamento|apartament|квартир|piso)\b/, 'apartment'],
    [/\b(villa|вилл|casa)\b/, 'villa'],
    [/\b(penthouse|atico|пентхаус)\b/, 'penthouse'],
    [/\b(townhouse|adosado|таунхаус)\b/, 'townhouse'],
    [/\b(commercial|local|коммерц)\b/, 'commercial'],
    [/\b(studio|estudio|студи)\b/, 'studio'],
    [/\b(room|habitacion|комнат)\b/, 'room']
  ];
  for (const [re, slug] of map) {
    if (re.test(s)) return slug;
  }
  return s;
};

const normalizeLocation = (v) => {
  const raw = toText(v);
  if (!raw) return null;
  return {
    raw,
    normalized: normalizeText(raw)
  };
};

const inferFeatureFlags = (insights = {}) => {
  const text = normalizeText(`${insights.preferences || ''} ${insights.details || ''}`);
  if (!text) return {};
  const out = {};
  if (/(parking|garage|garaje|паркинг|гараж)/.test(text)) out.hasParking = true;
  if (/(pool|piscina|бассейн)/.test(text)) out.hasPool = true;
  if (/(terrace|terraza|террас|balcon|balcony|балкон|лоджи)/.test(text)) out.hasTerrace = true;
  return out;
};

export const buildCanonicalQueryV1 = (insights = {}) => {
  const sourceInsights = {
    operation: insights?.operation ?? null,
    type: insights?.type ?? null,
    location: insights?.location ?? null,
    rooms: insights?.rooms ?? null,
    budget: insights?.budget ?? null,
    area: insights?.area ?? null,
    details: insights?.details ?? null,
    preferences: insights?.preferences ?? null,
    bathrooms: insights?.bathrooms ?? null
  };

  const canonicalPatch = {};
  const droppedFields = [];
  const missingFields = [];

  if (sourceInsights.operation) {
    const op = normalizeOperation(sourceInsights.operation);
    if (op) canonicalPatch.operation = op;
    else droppedFields.push({ field: 'operation', reason: 'invalid_operation', value: sourceInsights.operation });
  } else {
    missingFields.push('operation');
  }

  if (sourceInsights.type) {
    const type = normalizePropertyType(sourceInsights.type);
    if (type) canonicalPatch.type = type;
    else droppedFields.push({ field: 'type', reason: 'invalid_type', value: sourceInsights.type });
  } else {
    missingFields.push('type');
  }

  if (sourceInsights.location) {
    const loc = normalizeLocation(sourceInsights.location);
    if (loc?.normalized) canonicalPatch.location = loc;
    else droppedFields.push({ field: 'location', reason: 'invalid_location', value: sourceInsights.location });
  } else {
    missingFields.push('location');
  }

  if (sourceInsights.rooms !== null && sourceInsights.rooms !== undefined && String(sourceInsights.rooms).trim() !== '') {
    const rooms = parseFirstInt(sourceInsights.rooms);
    if (Number.isInteger(rooms) && rooms > 0) canonicalPatch.rooms = rooms;
    else droppedFields.push({ field: 'rooms', reason: 'invalid_rooms', value: sourceInsights.rooms });
  } else {
    missingFields.push('rooms');
  }

  if (sourceInsights.budget) {
    const maxPrice = parseMaxInt(sourceInsights.budget);
    if (Number.isInteger(maxPrice) && maxPrice > 0) canonicalPatch.maxPrice = maxPrice;
    else droppedFields.push({ field: 'budget', reason: 'invalid_budget', value: sourceInsights.budget });
  } else {
    missingFields.push('budget');
  }

  if (sourceInsights.area) {
    const maxArea = parseMaxInt(sourceInsights.area);
    if (Number.isInteger(maxArea) && maxArea > 0) canonicalPatch.maxArea = maxArea;
    else droppedFields.push({ field: 'area', reason: 'invalid_area', value: sourceInsights.area });
  } else {
    missingFields.push('area');
  }

  const featureFlags = inferFeatureFlags(sourceInsights);
  if (featureFlags.hasParking === true) canonicalPatch.hasParking = true;
  if (featureFlags.hasPool === true) canonicalPatch.hasPool = true;
  if (featureFlags.hasTerrace === true) canonicalPatch.hasTerrace = true;

  const preValidationQuery = { ...canonicalPatch };
  const postValidationQuery = { ...preValidationQuery };

  return {
    sourceInsights,
    canonicalPatch,
    preValidationQuery,
    postValidationQuery,
    droppedFields,
    missingFields
  };
};

const candidateTypeSlug = (candidate) => normalizePropertyType(candidate?.property_type || candidate?.type || '');
const candidateHasTerrace = (candidate) => {
  const terrace = Number(candidate?.terrace_m2);
  if (Number.isFinite(terrace)) return terrace > 0;
  return false;
};

const matchLocation = (candidate, loc) => {
  if (!loc?.normalized) return true;
  const hay = normalizeText(`${candidate?.city || ''} ${candidate?.district || ''} ${candidate?.neighborhood || ''}`);
  if (!hay) return false;
  return hay.includes(loc.normalized);
};

const byDeterministicOrder = (a, b) => {
  const pa = Number.isFinite(a?.priceEUR) ? a.priceEUR : Number.MAX_SAFE_INTEGER;
  const pb = Number.isFinite(b?.priceEUR) ? b.priceEUR : Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  const ia = String(a?.id || '');
  const ib = String(b?.id || '');
  return ia.localeCompare(ib);
};

export const executeCanonicalQueryV1 = ({ insights = {}, properties = [], limit = 10 } = {}) => {
  const trace = buildCanonicalQueryV1(insights);
  const q = trace.postValidationQuery || {};

  let filtered = Array.isArray(properties) ? properties.slice() : [];

  if (q.operation) filtered = filtered.filter((p) => String(p.operation || '').toLowerCase() === q.operation);
  if (q.type) filtered = filtered.filter((p) => candidateTypeSlug(p) === q.type);
  if (q.location) filtered = filtered.filter((p) => matchLocation(p, q.location));
  if (Number.isInteger(q.rooms)) filtered = filtered.filter((p) => Number(p.rooms) === q.rooms);
  if (Number.isInteger(q.maxPrice)) filtered = filtered.filter((p) => Number(p.priceEUR) <= q.maxPrice);
  if (Number.isInteger(q.maxArea)) filtered = filtered.filter((p) => Number(p.area_m2) <= q.maxArea);
  if (q.hasParking === true) filtered = filtered.filter((p) => p.has_parking === true);
  if (q.hasPool === true) filtered = filtered.filter((p) => p.has_pool === true);
  if (q.hasTerrace === true) filtered = filtered.filter((p) => candidateHasTerrace(p));

  const ordered = filtered.sort(byDeterministicOrder);
  const safeLimit = Math.max(1, Number.isInteger(limit) ? limit : 10);
  const candidates = ordered.slice(0, safeLimit);

  return {
    ...trace,
    matchedCount: ordered.length,
    candidates
  };
};
