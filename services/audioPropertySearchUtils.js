import { residentialComplexInputToArray, normalizeResidentialComplexName } from './residentialComplexMatcher.js';
import { buildScoreContext, annotatePropertyScoresByContext } from './scoringEngine.js';

// ====== Подбор карточек на основе insights / текста ======
export const parseBudgetEUR = (s) => {
  if (!s) return null;
  const m = String(s).replace(/[^0-9]/g, '');
  return m ? parseInt(m, 10) : null;
};

export const normalizeDistrict = (val) => {
  if (!val) return '';
  let s = String(val).toLowerCase().replace(/^район\s+/i, '').trim();
  const map = {
    // Odesa districts
    'одесса': 'odesa', 'одеса': 'odesa', 'odessa': 'odesa', 'odesa': 'odesa',
    'приморский': 'prymorskyi', 'проморский': 'prymorskyi', 'прыморский': 'prymorskyi', 'приморський': 'prymorskyi', 'проморський': 'prymorskyi', 'прыморський': 'prymorskyi', 'prymorskyi': 'prymorskyi', 'primorsky': 'prymorskyi', 'promorsky': 'prymorskyi',
    'киевский': 'kyivskyi', 'київський': 'kyivskyi', 'kyivskyi': 'kyivskyi', 'kievskiy': 'kyivskyi',
    'малиновский': 'khadzhibeyskyi', 'малиновський': 'khadzhibeyskyi', 'хаджибейский': 'khadzhibeyskyi', 'khadzhibeyskyi': 'khadzhibeyskyi',
    'суворовский': 'peresypskyi', 'суворовський': 'peresypskyi', 'пересыпский': 'peresypskyi', 'пересипський': 'peresypskyi', 'peresypskyi': 'peresypskyi',
    // Greater Odesa localities -> base district buckets
    'лиманка': 'kyivskyi', 'limanka': 'kyivskyi',
    'крыжановка': 'peresypskyi', 'крижанівка': 'peresypskyi', 'kryzhanivka': 'peresypskyi', 'kryzhanovka': 'peresypskyi',
    'авангард': 'khadzhibeyskyi', 'avangard': 'khadzhibeyskyi',
    // Odesa micro-areas / landmarks
    'аркадия': 'arcadia', 'аркадія': 'arcadia', 'arcadia': 'arcadia',
    'большой фонтан': 'fontan', 'великий фонтан': 'fontan', 'фонтан': 'fontan', 'fontan': 'fontan',
    'черемушки': 'cheremushky', 'черемушки одесса': 'cheremushky', 'cheremushky': 'cheremushky',
    'молдаванка': 'moldavanka', 'moldavanka': 'moldavanka',
    'слободка': 'slobidka', 'slobidka': 'slobidka',
    'поселок котовского': 'kotovskoho', 'селище котовського': 'kotovskoho', 'kotovskoho': 'kotovskoho',
    'лузановка': 'luzanivka', 'лузанівка': 'luzanivka', 'luzanivka': 'luzanivka'
  };
  return map[s] || s;
};

export const splitLocationTargets = (value) => {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .flatMap((item) => String(item || '').split(/\s*(?:,|\/|\\|\||\s+или\s+|\s+либо\s+|;)\s*/i))
    .map((part) => String(part || '').trim())
    .filter(Boolean);
};

export const getNormalizedLocationTargets = (locationValue) => {
  const parts = splitLocationTargets(locationValue);
  const targets = new Set();
  parts.forEach((part) => {
    const normalized = normalizeDistrict(part);
    if (normalized) targets.add(normalized);
    // Arcadia/center are typically queries inside Prymorsky district.
    if (normalized === 'arcadia' || normalized === 'fontan') {
      targets.add('prymorskyi');
    }
  });
  return Array.from(targets).filter((v) => v && v !== 'odesa');
};

export const hasHardFilters = (insights = {}) => {
  return Boolean(
    insights?.operation ||
    insights?.budget ||
    insights?.budgetMax ||
    insights?.type ||
    insights?.district ||
    insights?.location ||
    insights?.rooms
  );
};

export const normalizeOperationForProperty = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (/(buy|sale|sell|purchase|покуп|купить|продаж)/i.test(raw)) return 'buy';
  if (/(rent|lease|rental|аренд|оренд|снять)/i.test(raw)) return 'rent';
  return null;
};

export const normalizeCardIdValue = (value) => {
  const raw = String(value ?? '').trim();
  return raw ? raw.toUpperCase() : '';
};

export const normalizeTypeForProperty = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (/(apartment|flat|апартамент|апарты|квартир)/i.test(raw)) return 'apartment';
  if (/(house|villa|home|townhouse|дом|вилл|таунхаус)/i.test(raw)) return 'house';
  if (/(land|plot|участок|земля)/i.test(raw)) return 'land';
  if (/(commercial|office|retail|warehouse|коммер|офис|склад|нежил)/i.test(raw)) return 'commercial';
  return null;
};

export const getBudgetCap = (insights = {}) => {
  const fromMax = parseBudgetEUR(insights?.budgetMax);
  if (fromMax != null && Number.isFinite(fromMax)) return fromMax;
  const fromBudget = parseBudgetEUR(insights?.budget);
  if (fromBudget != null && Number.isFinite(fromBudget)) return fromBudget;
  return null;
};

export const parseIntLoose = (value) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const m = String(value).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
};

export const parseFloatLoose = (value) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value).replace(',', '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
};

export const toLowerTokens = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((v) => String(v == null ? '' : v).split(/[,\n;|]/))
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean);
  }
  return String(value)
    .split(/[,\n;|]/)
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
};

export const getRequestedAmenityFlags = (insights = {}) => {
  const pool = [
    ...toLowerTokens(insights?.features),
    ...toLowerTokens(insights?.details),
    ...toLowerTokens(insights?.preferences)
  ];
  const text = pool.join(' ');
  return {
    parking: /(parking|паркинг|парковк|паркомест|парко ?місц)/i.test(text),
    balcony: /(balcony|балкон|лоджи|лоджія|loggia)/i.test(text)
  };
};

export const parseFloorPreference = (insights = {}) => {
  const text = [
    ...toLowerTokens(insights?.floor),
    ...toLowerTokens(insights?.details),
    ...toLowerTokens(insights?.preferences),
    ...toLowerTokens(insights?.features)
  ].join(' ');
  const parsedFloor = parseIntLoose(insights?.floor);
  const numericFloor = Number.isFinite(parsedFloor) && parsedFloor > 0 ? parsedFloor : null;
  return {
    numericFloor,
    notFirst: /(не\s*перв|not\s*first)/i.test(text),
    notLast: /(не\s*послед|не\s*остан|not\s*last)/i.test(text),
    low: /(низк|low)/i.test(text),
    middle: /(средн|middle|mid)/i.test(text),
    high: /(высок|high)/i.test(text)
  };
};

export const getPropertyComplex = (property = {}) =>
  String(property?.features?.complex || property?.features?.display_specs?.complex || '').trim();

export const hasRcOnlySignal = (insights = {}) => {
  const rc = residentialComplexInputToArray(insights?.residentialComplex).join(', ');
  if (rc) return true;
  const parts = [];
  if (Array.isArray(insights?.features)) parts.push(...insights.features);
  else if (insights?.features != null) parts.push(insights.features);
  if (insights?.details != null) parts.push(insights.details);
  if (insights?.preferences != null) parts.push(insights.preferences);
  if (insights?.district != null) parts.push(insights.district);
  if (insights?.location != null) parts.push(insights.location);
  const text = parts.map((v) => String(v || '').toLowerCase()).join(' ');
  if (!text) return false;
  return /(?:только\s*[жз]к|лишь\s*[жз]к|исключительно\s*[жз]к|(?:^|\s)(?:[жз]к|[жз]\/к)(?:\s|$)|в\s*[жз]к|жил(?:ой|ого|ом|ые|ых)?\s+комплекс(?:ы|а|е|ах)?|в\s+жил(?:ом|ых)\s+комплекс(?:е|ах)|residential\s+complex(?:es)?)/i.test(text);
};

export const applyHardGateByInsights = (properties = [], insights = {}) => {
  let list = Array.isArray(properties) ? properties.slice() : [];
  const expectedOperation = normalizeOperationForProperty(insights?.operation);
  if (expectedOperation) {
    list = list.filter((p) => normalizeOperationForProperty(p?.operation) === expectedOperation);
  }
  const expectedType = normalizeTypeForProperty(insights?.type);
  if (expectedType) {
    list = list.filter((p) => normalizeTypeForProperty(p?.property_type) === expectedType);
  }
  const insightDistrictTargets = getNormalizedLocationTargets(
    insights?.district != null ? insights.district : insights?.location
  );
  if (insightDistrictTargets.length) {
    list = list.filter((p) => {
      const propParts = [
        normalizeDistrict(p?.district),
        normalizeDistrict(p?.neighborhood),
        normalizeDistrict(p?.city)
      ].filter(Boolean);
      if (!propParts.length) return false;
      return insightDistrictTargets.some((target) => propParts.some((propPart) => (
        propPart === target
        || propPart.includes(target)
        || target.includes(propPart)
      )));
    });
  }
  if (insights?.rcOnly === true || insights?.residentialComplexOnly === true || hasRcOnlySignal(insights)) {
    list = list.filter((p) => getPropertyComplex(p).length > 0);
  }
  const rcNeedles = residentialComplexInputToArray(insights?.residentialComplex)
    .map((value) => normalizeResidentialComplexName(value))
    .filter(Boolean);
  if (rcNeedles.length) {
    list = list.filter((p) => {
      const complex = normalizeResidentialComplexName(getPropertyComplex(p));
      return !!complex && rcNeedles.some((needle) => complex === needle || complex.includes(needle));
    });
  }

  // --- Strict District Gates ---
  if (insights?.arcadia === true) {
    list = list.filter((p) => {
      const d = String(p?.district || '').toLowerCase();
      const n = String(p?.neighborhood || '').toLowerCase();
      return d.includes('аркадия') || n.includes('аркадия') || d.includes('arcadia') || n.includes('arcadia');
    });
  }
  if (insights?.center === true) {
    list = list.filter((p) => {
      const d = String(p?.district || '').toLowerCase();
      const n = String(p?.neighborhood || '').toLowerCase();
      return d.includes('центр') || n.includes('центр') || d.includes('center') || n.includes('center');
    });
  }

  // --- Strict Feature Gates ---
  if (insights?.parking === true) {
    list = list.filter((p) => {
      const f = p?.features || {};
      return f.parking === true || f.parking === 'true' || f.parking === 1 || f.parking === '1';
    });
  }
  if (insights?.balconyLoggia === true) {
    list = list.filter((p) => {
      const f = p?.features || {};
      const hasBalcony = f.balcony === true || f.balcony === 'true' || f.balcony === 1 || f.balcony === '1';
      const hasLoggia = f.loggia === true || f.loggia === 'true' || f.loggia === 1 || f.loggia === '1';
      return hasBalcony || hasLoggia;
    });
  }

  return list;
};

export const normalizeRoomsConstraint = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (['4plus', '5plus'].includes(raw)) return raw;
  if (/^5\+?$/.test(raw)) return '5plus';
  if (/^4\+?$/.test(raw)) return '4plus';
  const parsed = parseIntLoose(raw);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '';
};

export const buildScoreContextFromInsights = (insights = {}) => {
  const floorPref = parseFloorPreference(insights);
  const budgetCap = getBudgetCap(insights);
  const exactArea = parseFloatLoose(insights?.area);
  const minArea = parseFloatLoose(insights?.areaMin);
  const maxArea = parseFloatLoose(insights?.areaMax);
  const areaMin = Number.isFinite(minArea) ? minArea : (Number.isFinite(exactArea) ? exactArea : null);
  const areaMax = Number.isFinite(maxArea) ? maxArea : (Number.isFinite(exactArea) ? exactArea : null);
  const floorExact = floorPref.numericFloor;
  const floorMin = Number.isFinite(floorExact) ? floorExact : (floorPref.notFirst ? 2 : null);
  const floorMax = Number.isFinite(floorExact) ? floorExact : null;
  const amenity = getRequestedAmenityFlags(insights);
  return buildScoreContext({
    roomsRaw: normalizeRoomsConstraint(insights?.rooms),
    minPrice: null,
    maxPrice: Number.isFinite(budgetCap) ? budgetCap : null,
    minArea: Number.isFinite(areaMin) ? areaMin : null,
    maxArea: Number.isFinite(areaMax) ? areaMax : null,
    minFloor: Number.isFinite(floorMin) ? floorMin : null,
    maxFloor: Number.isFinite(floorMax) ? floorMax : null,
    parkingRequired: amenity.parking === true,
    balconyRequired: amenity.balcony === true
  });
};

export const annotatePropertyWithScores = (property, insights = {}) => {
  const scoreContext = buildScoreContextFromInsights(insights);
  return annotatePropertyScoresByContext(property, scoreContext);
};

// Нормализация строки из БД к формату карточек, совместимому с фронтом
export const mapRowToProperty = (row) => {
  const toJsonObject = (v) => {
    if (!v) return null;
    if (typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v !== 'string') return null;
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const toJsonArray = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v !== 'string') return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const geo = toJsonObject(row.geo) || {};
  const features = toJsonObject(row.features) || {};
  const media = toJsonArray(row.media);

  const images = Array.isArray(row.images)
    ? row.images
    : (typeof row.images === 'string'
        ? (() => { try { return JSON.parse(row.images); } catch { return []; } })()
        : []);
  const mergedImages = (Array.isArray(images) ? images : []).filter(Boolean);
  if (!mergedImages.length && media.length) {
    for (const item of media) {
      if (!item || typeof item !== 'object') continue;
      if (String(item.type || '').toLowerCase() === 'video') continue;
      if (item.url) mergedImages.push(String(item.url));
    }
  }
  return {
    // важный момент: используем external_id как основной id (совместимость со старым фронтом)
    id: row.external_id || String(row.id),
    city: geo.city || row.location_city || null,
    district: geo.district || row.location_district || null,
    neighborhood: geo.neighborhood || row.location_neighborhood || null,
    operation: row.operation || null,
    property_type: row.property_type || null,
    price_period: row.price_period || null,
    priceEUR: row.price_amount != null ? Number(row.price_amount) : null,
    price_per_m2: row.price_per_m2 != null ? Number(row.price_per_m2) : (features.pricePerM2 != null ? Number(features.pricePerM2) : null),
    rooms: row.specs_rooms != null ? Number(row.specs_rooms) : (features.rooms != null ? Number(features.rooms) : null),
    bathrooms: row.specs_bathrooms != null ? Number(row.specs_bathrooms) : (features.bathrooms != null ? Number(features.bathrooms) : null),
    area_m2: row.specs_area_m2 != null ? Number(row.specs_area_m2) : (features.areaM2 != null ? Number(features.areaM2) : null),
    floor: row.specs_floor != null ? Number(row.specs_floor) : (features.floor != null ? Number(features.floor) : null),
    description: row.description || null,
    images: mergedImages,
    geo,
    features,
    media
  };
};
