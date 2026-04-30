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

const parseUniquePositiveInts = (v) => {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return Array.from(
      new Set(
        v
          .map((x) => (typeof x === 'number' ? Math.round(x) : Number.parseInt(String(x), 10)))
          .filter((n) => Number.isInteger(n) && n > 0)
      )
    );
  }
  const nums = (String(v).match(/\d+/g) || [])
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return Array.from(new Set(nums));
};

const parseLocationTokens = (rawValue) => {
  const raw = toText(rawValue);
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/,|;|\/|\s+(?:и|или|or|y)\s+/gi)
        .map((x) => normalizeLocationToken(x))
        .filter(Boolean)
    )
  );
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

const parseMinInt = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const nums = (String(v).replace(/\s/g, '').match(/\d+/g) || [])
    .map((x) => Number.parseInt(x, 10))
    .filter(Number.isFinite);
  if (!nums.length) return null;
  return Math.min(...nums);
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
  if (/(apartment|apartamento|apartament|piso|квартир|апартамент)/.test(s)) return 'apartment';
  if (/(villa|casa|вилл|дом)/.test(s)) return 'villa';
  if (/(penthouse|atico|атико|пентхаус)/.test(s)) return 'penthouse';
  if (/(townhouse|adosado|таунхаус)/.test(s)) return 'townhouse';
  if (/(commercial|local|коммерц)/.test(s)) return 'commercial';
  if (/(studio|estudio|студи)/.test(s)) return 'studio';
  if (/(room|habitacion|комнат)/.test(s)) return 'room';
  return s;
};

const LOCATION_ALIASES = new Map([
  ['торревьеха', 'torrevieja'],
  ['торревьехе', 'torrevieja'],
  ['аликанте', 'alicante'],
  ['бенидорм', 'benidorm'],
  ['кальпе', 'calpe'],
  ['кальпа', 'calpe'],
  ['мурсия', 'murcia'],
  ['валенсия', 'valencia'],
  ['валенсии', 'valencia'],
  ['в валенсии', 'valencia'],
  ['орихуэла', 'orihuela'],
  ['ориуэла', 'orihuela'],
  ['орихуэла коста', 'orihuela costa'],
  ['ориуэла коста', 'orihuela costa'],
  ['пунта прима', 'punta prima'],
  ['вилламартин', 'villamartin'],
  ['вильямартин', 'villamartin'],
  ['ла зения', 'la zenia'],
  ['лос алькасарес', 'los alcazares'],
  ['коста бланка', 'costa blanca'],
  ['коста брава', 'costa brava'],
  ['коста дель соль', 'costa del sol']
]);

const normalizeLocationToken = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  const withoutPrep = raw.replace(/^(в|на|en)\s+/, '').trim();
  return LOCATION_ALIASES.get(raw) || LOCATION_ALIASES.get(withoutPrep) || withoutPrep;
};

const normalizeLocation = (v) => {
  const raw = toText(v);
  if (!raw) return null;
  const n = normalizeLocationToken(raw);
  const genericCoastTerms = new Set([
    'побережье', 'на побережье', 'у побережья',
    'coast', 'near coast', 'on the coast',
    'costa', 'costa blanca', 'costa brava', 'costa del sol'
  ]);
  if (genericCoastTerms.has(n)) return null;
  return {
    raw,
    normalized: n
  };
};

const LOCATION_PROVINCES = new Set(['alicante', 'murcia', 'valencia']);

const CITY_TO_PROVINCE = new Map([
  ['alicante', 'alicante'],
  ['valencia', 'valencia'],
  ['torrevieja', 'alicante'],
  ['benidorm', 'alicante'],
  ['calpe', 'alicante'],
  ['orihuela', 'alicante'],
  ['orihuela costa', 'alicante'],
  ['pilar de la horadada', 'alicante'],
  ['san miguel de salinas', 'alicante'],
  ['guardamar', 'alicante'],
  ['guardamar del segura', 'alicante'],
  ['los alcazares', 'murcia'],
  ['san pedro del pinatar', 'murcia'],
  ['paterna', 'valencia'],
  ['torrent', 'valencia']
]);

const MICRO_LOCATION_HINTS = [
  'punta prima',
  'villamartin',
  'la zenia',
  'cabo roig',
  'playa flamenca',
  'los balcones',
  'campoamor',
  'las colinas golf',
  'las ramblas',
  'la mata',
  'ciudad quesada',
  'lomas de cabo roig',
  'finestrat',
  'blue lagoon',
  'los altos'
];

const parseLocationSemantics = (rawValue) => {
  const raw = toText(rawValue);
  const normalized = normalizeLocationToken(raw);
  const out = {
    raw: raw || null,
    normalized: normalized || null,
    cities: [],
    city: null,
    province: null,
    location: null,
    featureHints: []
  };
  if (!normalized) return out;

  if (/(возле моря|у моря|рядом с морем|возле пляжа|рядом с пляжем|near sea|near the sea|near beach|near the beach|cerca del mar|cerca de la playa|playa|пляж|побереж|coast|costa)/.test(normalized)) {
    out.featureHints.push('near_sea');
  }

  const tokens = parseLocationTokens(raw);
  if (tokens.length > 1) {
    const cities = [];
    const provinces = new Set();
    for (const token of tokens) {
      if (CITY_TO_PROVINCE.has(token)) {
        cities.push(token);
        provinces.add(CITY_TO_PROVINCE.get(token));
        continue;
      }
      if (LOCATION_PROVINCES.has(token)) {
        provinces.add(token);
      }
    }
    if (cities.length > 0) {
      out.cities = Array.from(new Set(cities));
      if (provinces.size === 1) out.province = Array.from(provinces)[0];
      return out;
    }
  }

  if (CITY_TO_PROVINCE.has(normalized)) {
    out.cities = [normalized];
    out.city = normalized;
    out.province = CITY_TO_PROVINCE.get(normalized) || null;
    return out;
  }

  if (LOCATION_PROVINCES.has(normalized)) {
    // Ambiguous city/province names (Alicante/Valencia): keep city-first intent + province link.
    out.cities = [normalized];
    out.city = normalized;
    out.province = normalized;
    return out;
  }

  if (MICRO_LOCATION_HINTS.some((x) => normalized.includes(x))) {
    out.location = normalized;
    return out;
  }

  // Coastal phrases are feature-only hints, not a geographic location token.
  if (out.featureHints.includes('near_sea')) {
    return out;
  }

  // Default interpretation: city-first, with optional province autolink if known.
  out.city = normalized;
  out.province = CITY_TO_PROVINCE.get(normalized) || null;
  return out;
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
    locationsRaw: Array.isArray(insights?.locationsRaw) ? insights.locationsRaw : (insights?.locationsRaw ? [insights.locationsRaw] : null),
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
  let locationSemantics = null;
  let locationExtraction = null;

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

  const rawLocationsList = Array.isArray(sourceInsights.locationsRaw)
    ? sourceInsights.locationsRaw.map((x) => toText(x)).filter(Boolean)
    : [];
  const extractionLocationSource = rawLocationsList.length > 0
    ? rawLocationsList.join(' и ')
    : sourceInsights.location;
  locationExtraction = {
    source: rawLocationsList.length > 0 ? 'locationsRaw' : 'location',
    raw: extractionLocationSource || null,
    locationsRaw: rawLocationsList.length > 0 ? rawLocationsList : null
  };

  if (extractionLocationSource) {
    locationSemantics = parseLocationSemantics(extractionLocationSource);
    const coastLike = Array.isArray(locationSemantics?.featureHints) && locationSemantics.featureHints.includes('near_sea');
    if (coastLike) {
      const f = mergeFeatures(sourceInsights.features, 'near_sea', inferred.features);
      if (f.length) canonicalPatch.features = f;
    }
    if (!coastLike) {
      const cityList = Array.isArray(locationSemantics?.cities) ? locationSemantics.cities.filter(Boolean) : [];
      if (cityList.length > 0) {
        canonicalPatch.cities = cityList;
        if (locationSemantics?.province) canonicalPatch.province = locationSemantics.province;
      } else {
        const chosenLocationToken =
          locationSemantics?.city ||
          locationSemantics?.location ||
          locationSemantics?.province ||
          null;
        const loc = normalizeLocation(chosenLocationToken || extractionLocationSource);
        if (loc?.normalized) {
          canonicalPatch.location = loc;
        } else {
          droppedFields.push({ field: 'location', reason: 'invalid_location', value: extractionLocationSource });
        }
      }
    }
  } else {
    missingFields.push('location');
  }

  const roomsList = parseUniquePositiveInts(sourceInsights.rooms);
  if (roomsList.length > 1) canonicalPatch.rooms = roomsList;
  else if (roomsList.length === 1) canonicalPatch.rooms = roomsList[0];
  else missingFields.push('rooms');

  const bathrooms = parseFirstInt(sourceInsights.bathrooms ?? inferred.bathrooms);
  if (Number.isInteger(bathrooms) && bathrooms > 0) canonicalPatch.bathrooms = bathrooms;
  else missingFields.push('bathrooms');

  const minPrice = parseMinInt(sourceInsights.budget);
  if (Number.isInteger(minPrice) && minPrice > 0) {
    const op = canonicalPatch.operation || null;
    if (op === 'sale') {
      if (minPrice >= 10000) canonicalPatch.minPrice = minPrice;
      else droppedFields.push({ field: 'minPrice', reason: 'sale_budget_too_low', value: sourceInsights.budget });
    } else if (op === 'rent') {
      if (minPrice < 10000) canonicalPatch.minPrice = minPrice;
      else droppedFields.push({ field: 'minPrice', reason: 'rent_budget_too_high', value: sourceInsights.budget });
    } else {
      // If operation is unknown, keep previous permissive behavior.
      canonicalPatch.minPrice = minPrice;
    }
  } else {
    missingFields.push('minPrice');
  }

  const minArea = parseMinInt(sourceInsights.area);
  if (Number.isInteger(minArea) && minArea > 0) canonicalPatch.minArea = minArea;
  else missingFields.push('minArea');

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

  const features = mergeFeatures(canonicalPatch.features, sourceInsights.features, inferred.features);
  if (features.length) canonicalPatch.features = features;
  else missingFields.push('features');

  const preValidationQuery = { ...canonicalPatch };
  const postValidationQuery = { ...preValidationQuery };

  return {
    sourceInsights,
    locationExtraction,
    locationSemantics,
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

const matchCity = (candidate, citySlug) => {
  const city = normalizeLocationToken(candidate?.city || candidate?.location_city || '');
  if (!city || !citySlug) return false;
  return city === citySlug;
};

const matchProvince = (candidate, provinceSlug) => {
  const province = normalizeLocationToken(candidate?.district || candidate?.location_district || '');
  if (!province || !provinceSlug) return false;
  return province === provinceSlug;
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
  const pre = trace.preValidationQuery || {};
  const q = { ...trace.postValidationQuery };

  // Business softening for core numeric constraints.
  if (Number.isInteger(q.minPrice) && q.minPrice > 0) q.minPrice = Math.max(1, Math.floor(q.minPrice * 0.8));
  if (Number.isInteger(q.minArea) && q.minArea > 0) q.minArea = Math.max(1, Math.floor(q.minArea * 0.8));
  if (Number.isInteger(q.plotArea) && q.plotArea > 0) q.plotArea = Math.max(1, Math.floor(q.plotArea * 0.8));

  const all = Array.isArray(properties) ? properties.slice() : [];

  const applyByQuery = (source, query, skip = new Set()) => {
    let filtered = source.slice();

    // Core strict
    if (query.operation) filtered = filtered.filter((p) => String(p.operation || '').toLowerCase() === query.operation);
    if (query.type) filtered = filtered.filter((p) => candidateTypeSlug(p) === query.type);
    if (Array.isArray(query.cities) && query.cities.length) {
      const citySet = new Set(query.cities.map((c) => normalizeLocationToken(c)).filter(Boolean));
      if (citySet.size > 0) filtered = filtered.filter((p) => citySet.has(normalizeLocationToken(p?.city || p?.location_city || '')));
    } else if (query.location) {
      filtered = filtered.filter((p) => matchLocation(p, query.location));
    }
    if (query.province && (!Array.isArray(query.cities) || query.cities.length === 0)) {
      filtered = filtered.filter((p) => matchProvince(p, query.province));
    }
    if (Number.isInteger(query.rooms)) {
      filtered = filtered.filter((p) => Number(p.rooms) === query.rooms);
    } else if (Array.isArray(query.rooms) && query.rooms.length) {
      const roomSet = new Set(
        query.rooms
          .map((n) => Number.parseInt(String(n), 10))
          .filter((n) => Number.isInteger(n) && n > 0)
      );
      if (roomSet.size > 0) {
        filtered = filtered.filter((p) => roomSet.has(Number(p.rooms)));
      }
    }
    if (Number.isInteger(query.minPrice)) filtered = filtered.filter((p) => Number(p.priceEUR) >= query.minPrice);
    if (Number.isInteger(query.minArea)) filtered = filtered.filter((p) => Number(p.area_m2) >= query.minArea);
    if (Number.isInteger(query.plotArea)) filtered = filtered.filter((p) => Number(p.plot_m2) >= query.plotArea);

    // Relaxed-able
    if (!skip.has('bathrooms') && Number.isInteger(query.bathrooms)) filtered = filtered.filter((p) => Number(p.bathrooms) >= query.bathrooms);
    if (!skip.has('floor') && Number.isInteger(query.floor)) filtered = filtered.filter((p) => Number(p.floor) === query.floor);
    if (!skip.has('hasParking') && query.hasParking === true) filtered = filtered.filter((p) => p.has_parking === true);
    if (!skip.has('hasPool') && query.hasPool === true) filtered = filtered.filter((p) => p.has_pool === true);
    if (!skip.has('hasTerrace') && query.hasTerrace === true) filtered = filtered.filter((p) => candidateHasTerrace(p));
    if (!skip.has('orientation') && query.orientation) filtered = filtered.filter((p) => candidateOrientation(p) === query.orientation);

    if (!skip.has('distanceBeachKmMax') && Number.isFinite(query.distanceBeachKmMax)) {
      filtered = filtered.filter((p) => {
        const d = candidateDistanceKm(p.distance_beach, p.distance_beach_med);
        return Number.isFinite(d) && d <= query.distanceBeachKmMax;
      });
    }

    if (!skip.has('distanceAirportKmMax') && Number.isFinite(query.distanceAirportKmMax)) {
      filtered = filtered.filter((p) => {
        const d = candidateDistanceKm(p.distance_airport, p.distance_airport_med);
        return Number.isFinite(d) && d <= query.distanceAirportKmMax;
      });
    }

    if (!skip.has('features') && Array.isArray(query.features) && query.features.length) {
      filtered = filtered.filter((p) => {
        const featureSet = candidateFeatureSet(p);
        return query.features.every((slug) => featureSet.has(slug));
      });
    }

    return filtered;
  };

  const relaxOrder = [
    'hasParking',
    'hasTerrace',
    'distanceBeachKmMax',
    'distanceAirportKmMax',
    'hasPool',
    'features',
    'bathrooms',
    'floor',
    'orientation'
  ];
  const hasRelaxedInQuery = relaxOrder.some((k) => q[k] !== undefined && q[k] !== null && q[k] !== false);
  const droppedRelaxed = [];
  let usedRelaxedFallback = false;
  let filtered = applyByQuery(all, q, new Set());
  let locationScope = Array.isArray(q.cities) && q.cities.length ? 'city' : (q.province ? 'province' : null);
  let locationFallbackMessage = null;

  if (filtered.length === 0 && Array.isArray(q.cities) && q.cities.length && q.province) {
    const provinceFallbackQuery = { ...q };
    delete provinceFallbackQuery.cities;
    const provinceProbe = applyByQuery(all, provinceFallbackQuery, new Set());
    if (provinceProbe.length > 0) {
      filtered = provinceProbe;
      usedRelaxedFallback = true;
      droppedRelaxed.push('cities');
      locationScope = 'province_fallback';
      locationFallbackMessage = 'По городу пусто · ищем по провинции';
    }
  }

  if (filtered.length === 0 && hasRelaxedInQuery) {
    usedRelaxedFallback = true;
    const skip = new Set();
    for (const key of relaxOrder) {
      if (!(key in q) || q[key] === null || q[key] === undefined || q[key] === false) continue;
      skip.add(key);
      const probe = applyByQuery(all, q, skip);
      droppedRelaxed.push(key);
      if (probe.length > 0) {
        filtered = probe;
        break;
      }
      filtered = probe;
    }
  }

  const ordered = filtered.sort(byDeterministicOrder);
  const safeLimit = Math.max(1, Number.isInteger(limit) ? limit : 10);
  const candidates = ordered.slice(0, safeLimit);

  return {
    ...trace,
    preValidationQuery: { ...pre },
    postValidationQuery: { ...q },
    relaxed: {
      used: usedRelaxedFallback,
      dropped: droppedRelaxed,
      message: usedRelaxedFallback
      ? (locationFallbackMessage ? null : 'Точные совпадения не найдены, показаны ближайшие по ослабленным параметрам.')
      : null
      ,
      locationScope,
      locationFallbackMessage
    },
    matchedCount: ordered.length,
    candidates
  };
};
