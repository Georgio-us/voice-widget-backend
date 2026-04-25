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
  const m = String(v).replace(/\s/g, '').match(/-?\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
};

const parseFirstFloat = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const m = String(v).replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const parseMaxInt = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const nums = (String(v).replace(/\s/g, '').match(/\d+/g) || [])
    .map((x) => Number.parseInt(x, 10))
    .filter(Number.isFinite);
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

const normalizeOrientation = (v) => {
  const s = normalizeText(v);
  if (!s) return null;
  if (/(north|norte|север|\bn\b)/.test(s)) return 'north';
  if (/(south|sur|юг|\bs\b)/.test(s)) return 'south';
  if (/(east|este|восток|\be\b)/.test(s)) return 'east';
  if (/(west|oeste|запад|\bw\b|\bo\b)/.test(s)) return 'west';
  return s;
};

const normalizeFeatureSlug = (v) => {
  const s = normalizeText(v);
  if (!s) return null;
  if (/(sea view|vistas al mar|вид на море)/.test(s)) return 'sea_view';
  if (/(near the sea|near sea|cerca del mar|у моря|рядом с морем|playa)/.test(s)) return 'near_sea';
  if (/(pool view|vista piscina|вид на бассейн)/.test(s)) return 'pool_view';
  if (/(mountain view|vista montana|вид на горы)/.test(s)) return 'mountain_view';
  if (/(golf)/.test(s)) return 'golf';
  if (/(first line|primera linea|первая линия)/.test(s)) return 'first_line';
  if (/(open view|open views|vistas abiertas|открытый вид)/.test(s)) return 'open_view';
  if (/(village view|village views|вид на поселок)/.test(s)) return 'village_view';
  if (/(new listing|нов[а-я]+ объект)/.test(s)) return 'new_listing';
  return s.replace(/\s+/g, '_');
};

const toDistanceKm = (value, unit) => {
  const num = parseFirstFloat(value);
  if (!Number.isFinite(num)) return null;
  const u = normalizeText(unit);
  if (!u || /(km|kilom)/.test(u)) return num;
  if (/(mt|mts|m|meter|metre|metro)/.test(u)) return num / 1000;
  return num;
};

const extractFromText = (text = '') => {
  const s = normalizeText(text);
  if (!s) return {};
  const out = {};

  if (/(parking|garage|garaje|паркинг|гараж)/.test(s)) out.hasParking = true;
  if (/(pool|piscina|бассейн)/.test(s)) out.hasPool = true;
  if (/(terrace|terraza|террас|balcony|balcon|балкон|лодж)/.test(s)) out.hasTerrace = true;

  const baths = s.match(/(\d+)\s*(bath|bathroom|bano|bano?s|ванн|сануз)/);
  if (baths) out.bathrooms = Number.parseInt(baths[1], 10);

  const floor = s.match(/(\d+)\s*(floor|planta|этаж)/);
  if (floor) out.floor = Number.parseInt(floor[1], 10);

  const plot = s.match(/(\d+)\s*(m2|м2|m²|м²)\s*(plot|parcela|участ)/);
  if (plot) out.plotArea = Number.parseInt(plot[1], 10);

  const orient = normalizeOrientation(s);
  if (orient) out.orientation = orient;

  const beach = s.match(/(\d+(?:[.,]\d+)?)\s*(km|км|m|м|mts|метр)[^\n]{0,24}(beach|playa|мор)/);
  if (beach) out.distanceBeachKmMax = toDistanceKm(beach[1], beach[2]);

  const airport = s.match(/(\d+(?:[.,]\d+)?)\s*(km|км|m|м|mts|метр)[^\n]{0,24}(airport|aeropuerto|аэропорт)/);
  if (airport) out.distanceAirportKmMax = toDistanceKm(airport[1], airport[2]);

  const features = [];
  const featureChecks = [
    'sea view', 'near the sea', 'pool views', 'mountain views', 'golf', 'first line', 'open views', 'village views'
  ];
  for (const raw of featureChecks) {
    const slug = normalizeFeatureSlug(raw);
    if (slug && s.includes(normalizeText(raw))) features.push(slug);
  }
  if (features.length) out.features = Array.from(new Set(features));

  return out;
};

const mergeFeatures = (...parts) => {
  const set = new Set();
  for (const src of parts) {
    if (!src) continue;
    if (Array.isArray(src)) {
      src.forEach((x) => {
        const slug = normalizeFeatureSlug(x);
        if (slug) set.add(slug);
      });
    } else {
      const slug = normalizeFeatureSlug(src);
      if (slug) set.add(slug);
    }
  }
  return Array.from(set);
};

export const buildCanonicalQueryV1 = (insights = {}) => {
  const textCtx = `${insights?.details || ''} ${insights?.preferences || ''}`.trim();
  const inferred = extractFromText(textCtx);

  const sourceInsights = {
    operation: insights?.operation ?? null,
    type: insights?.type ?? null,
    location: insights?.location ?? null,
    rooms: insights?.rooms ?? null,
    bathrooms: insights?.bathrooms ?? null,
    budget: insights?.budget ?? null,
    area: insights?.area ?? null,
    plotArea: insights?.plotArea ?? null,
    floor: insights?.floor ?? null,
    hasParking: insights?.hasParking ?? null,
    hasPool: insights?.hasPool ?? null,
    hasTerrace: insights?.hasTerrace ?? null,
    orientation: insights?.orientation ?? null,
    distanceBeach: insights?.distanceBeach ?? null,
    distanceAirport: insights?.distanceAirport ?? null,
    features: insights?.features ?? null,
    details: insights?.details ?? null,
    preferences: insights?.preferences ?? null
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

  const rooms = parseFirstInt(sourceInsights.rooms);
  if (Number.isInteger(rooms) && rooms > 0) canonicalPatch.rooms = rooms;
  else missingFields.push('rooms');

  const bathrooms = parseFirstInt(sourceInsights.bathrooms ?? inferred.bathrooms);
  if (Number.isInteger(bathrooms) && bathrooms > 0) canonicalPatch.bathrooms = bathrooms;
  else missingFields.push('bathrooms');

  const maxPrice = parseMaxInt(sourceInsights.budget);
  if (Number.isInteger(maxPrice) && maxPrice > 0) canonicalPatch.maxPrice = maxPrice;
  else missingFields.push('maxPrice');

  const maxArea = parseMaxInt(sourceInsights.area);
  if (Number.isInteger(maxArea) && maxArea > 0) canonicalPatch.maxArea = maxArea;
  else missingFields.push('maxArea');

  const plotArea = parseMaxInt(sourceInsights.plotArea ?? inferred.plotArea);
  if (Number.isInteger(plotArea) && plotArea > 0) canonicalPatch.plotArea = plotArea;
  else missingFields.push('plotArea');

  const floor = parseFirstInt(sourceInsights.floor ?? inferred.floor);
  if (Number.isInteger(floor) && floor > 0) canonicalPatch.floor = floor;
  else missingFields.push('floor');

  const hasParking = sourceInsights.hasParking === true || inferred.hasParking === true;
  const hasPool = sourceInsights.hasPool === true || inferred.hasPool === true;
  const hasTerrace = sourceInsights.hasTerrace === true || inferred.hasTerrace === true;
  if (hasParking) canonicalPatch.hasParking = true; else missingFields.push('hasParking');
  if (hasPool) canonicalPatch.hasPool = true; else missingFields.push('hasPool');
  if (hasTerrace) canonicalPatch.hasTerrace = true; else missingFields.push('hasTerrace');

  const orientation = normalizeOrientation(sourceInsights.orientation ?? inferred.orientation);
  if (orientation) canonicalPatch.orientation = orientation;
  else missingFields.push('orientation');

  const distanceBeachKmMax = toDistanceKm(sourceInsights.distanceBeach, sourceInsights.distanceBeachUnit) ?? inferred.distanceBeachKmMax ?? null;
  if (Number.isFinite(distanceBeachKmMax) && distanceBeachKmMax > 0) canonicalPatch.distanceBeachKmMax = Number(distanceBeachKmMax);
  else missingFields.push('distanceBeachKmMax');

  const distanceAirportKmMax = toDistanceKm(sourceInsights.distanceAirport, sourceInsights.distanceAirportUnit) ?? inferred.distanceAirportKmMax ?? null;
  if (Number.isFinite(distanceAirportKmMax) && distanceAirportKmMax > 0) canonicalPatch.distanceAirportKmMax = Number(distanceAirportKmMax);
  else missingFields.push('distanceAirportKmMax');

  const features = mergeFeatures(sourceInsights.features, inferred.features);
  if (features.length) canonicalPatch.features = features;
  else missingFields.push('features');

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
  return Number.isFinite(terrace) && terrace > 0;
};

const candidateOrientation = (candidate) => normalizeOrientation(candidate?.orientation || '');

const matchLocation = (candidate, loc) => {
  if (!loc?.normalized) return true;
  const hay = normalizeText(`${candidate?.city || ''} ${candidate?.district || ''} ${candidate?.neighborhood || ''}`);
  return !!hay && hay.includes(loc.normalized);
};

const candidateDistanceKm = (value, unit) => toDistanceKm(value, unit);

const candidateFeatureSet = (candidate) => {
  const set = new Set();
  const tags = Array.isArray(candidate?.tags) ? candidate.tags : [];
  tags.forEach((t) => {
    const slug = normalizeFeatureSlug(t);
    if (slug) set.add(slug);
  });
  return set;
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
  if (Number.isInteger(q.bathrooms)) filtered = filtered.filter((p) => Number(p.bathrooms) >= q.bathrooms);
  if (Number.isInteger(q.maxPrice)) filtered = filtered.filter((p) => Number(p.priceEUR) <= q.maxPrice);
  if (Number.isInteger(q.maxArea)) filtered = filtered.filter((p) => Number(p.area_m2) <= q.maxArea);
  if (Number.isInteger(q.plotArea)) filtered = filtered.filter((p) => Number(p.plot_m2) >= q.plotArea);
  if (Number.isInteger(q.floor)) filtered = filtered.filter((p) => Number(p.floor) === q.floor);
  if (q.hasParking === true) filtered = filtered.filter((p) => p.has_parking === true);
  if (q.hasPool === true) filtered = filtered.filter((p) => p.has_pool === true);
  if (q.hasTerrace === true) filtered = filtered.filter((p) => candidateHasTerrace(p));
  if (q.orientation) filtered = filtered.filter((p) => candidateOrientation(p) === q.orientation);

  if (Number.isFinite(q.distanceBeachKmMax)) {
    filtered = filtered.filter((p) => {
      const d = candidateDistanceKm(p.distance_beach, p.distance_beach_med);
      return Number.isFinite(d) && d <= q.distanceBeachKmMax;
    });
  }

  if (Number.isFinite(q.distanceAirportKmMax)) {
    filtered = filtered.filter((p) => {
      const d = candidateDistanceKm(p.distance_airport, p.distance_airport_med);
      return Number.isFinite(d) && d <= q.distanceAirportKmMax;
    });
  }

  if (Array.isArray(q.features) && q.features.length) {
    filtered = filtered.filter((p) => {
      const featureSet = candidateFeatureSet(p);
      return q.features.every((slug) => featureSet.has(slug));
    });
  }

  const ordered = filtered.sort(byDeterministicOrder);
  const safeLimit = Math.max(1, Number.isInteger(limit) ? limit : 10);
  const candidates = ordered.slice(0, safeLimit);

  return {
    ...trace,
    matchedCount: ordered.length,
    candidates
  };
};
