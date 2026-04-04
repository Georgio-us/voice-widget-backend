import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import {
  getOlxIntegrationCredentials,
  upsertOlxIntegration
} from './olxIntegrationRepository.js';
import { refreshAccessToken } from './olxOAuthService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_OLX_DIR = path.join(__dirname, '..', 'data', 'olx');

const normalize = (value) => String(value || '').trim();

const toNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  // Common formats from OLX attributes: "3/9", "80-90", "36,5"
  const primaryChunk = raw.split('/')[0].split('-')[0];
  const cleaned = String(primaryChunk)
    .trim()
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

const toInt = (value) => {
  const num = toNumber(value);
  return Number.isFinite(num) ? Math.round(num) : null;
};

const readJsonConfig = (filename, fallback) => {
  try {
    const fullPath = path.join(DATA_OLX_DIR, filename);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch {
    return fallback;
  }
};

const DISTRICT_CONFIG = readJsonConfig('district-map.json', {
  by_city_id: {},
  by_district_id: {},
  district_aliases: {}
});

const CATEGORY_CONFIG = readJsonConfig('category-map.json', {
  by_category_id: {},
  defaults: {
    operation: 'sale',
    property_type: 'apartment'
  },
  room_slug_to_number: {
    odnokomnatnye: 1,
    dvuhkomnatnye: 2,
    trehkomnatnye: 3,
    chetyrehkomnatnye: 4,
    pyatikomnatnye: 5,
    '6_i_bolee': 6,
    six_and_more: 6,
    one_room: 1,
    two_rooms: 2,
    three_rooms: 3,
    four_rooms: 4,
    five_rooms: 5,
    studio: 1
  }
});

const FX_CONFIG = readJsonConfig('currency-rates.json', {
  base: 'USD',
  rates_to_usd: {
    USD: 1,
    UAH: 0.024,
    EUR: 1.08,
    PLN: 0.26,
    AED: 0.2723
  }
});

const OLX_PARTNER_BASE = () =>
  normalize(process.env.OLX_PARTNER_API_BASE) || 'https://www.olx.ua/api/partner';

const ACTIVE_STATUSES = new Set(['new', 'active', 'limited', 'unconfirmed', 'unpaid', 'moderated']);

const DEFAULTS = {
  operation: normalize(CATEGORY_CONFIG?.defaults?.operation).toLowerCase() || 'sale',
  propertyType: normalize(CATEGORY_CONFIG?.defaults?.property_type).toLowerCase() || 'apartment'
};

const ROOM_SLUG_TO_NUMBER = CATEGORY_CONFIG?.room_slug_to_number && typeof CATEGORY_CONFIG.room_slug_to_number === 'object'
  ? CATEGORY_CONFIG.room_slug_to_number
  : {};

const getCfgMapValue = (obj, key) => {
  if (!obj || typeof obj !== 'object') return null;
  const direct = obj[String(key)];
  if (direct !== undefined) return direct;
  return obj[Number.isFinite(Number(key)) ? String(Number(key)) : key] ?? null;
};

const normalizeBoolToken = (value) => {
  const raw = normalize(value).toLowerCase();
  if (!raw) return null;
  if (['1', 'true', 'yes', 'y', 'on', 'есть', 'так', 'да'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'нет', 'ні'].includes(raw)) return false;
  return null;
};

const buildAttributesIndex = (attributes = []) => {
  const map = new Map();
  if (!Array.isArray(attributes)) return map;
  for (const attr of attributes) {
    const code = normalize(attr?.code).toLowerCase();
    if (!code) continue;
    const value = attr?.value;
    const values = Array.isArray(attr?.values) ? attr.values : [];
    const entry = {
      code,
      value,
      values
    };
    const bucket = map.get(code);
    if (bucket) {
      bucket.push(entry);
    } else {
      map.set(code, [entry]);
    }
  }
  return map;
};

const getAttrEntries = (attrsIndex, codes = []) => {
  const out = [];
  for (const code of codes) {
    const key = normalize(code).toLowerCase();
    if (!key) continue;
    const entries = attrsIndex.get(key);
    if (Array.isArray(entries) && entries.length) {
      out.push(...entries);
    }
  }
  return out;
};

const extractAttrPrimitive = (value, depth = 0) => {
  if (value === null || value === undefined) return null;
  if (depth > 4) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = normalize(value);
    return text || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractAttrPrimitive(item, depth + 1);
      if (extracted) return extracted;
    }
    return null;
  }
  if (typeof value === 'object') {
    const candidates = [
      value?.value,
      value?.key,
      value?.id,
      value?.slug,
      value?.code,
      value?.label,
      value?.name
    ];
    for (const candidate of candidates) {
      const extracted = extractAttrPrimitive(candidate, depth + 1);
      if (extracted) return extracted;
    }
  }
  return null;
};

const getAttrText = (attrsIndex, codes = []) => {
  const entries = getAttrEntries(attrsIndex, codes);
  for (const entry of entries) {
    const direct = extractAttrPrimitive(entry.value);
    if (direct) return direct;
    if (Array.isArray(entry.values) && entry.values.length) {
      for (const item of entry.values) {
        const extracted = extractAttrPrimitive(item);
        if (extracted) return extracted;
      }
    }
  }
  return null;
};

const getAttrList = (attrsIndex, codes = []) => {
  const out = [];
  const entries = getAttrEntries(attrsIndex, codes);
  for (const entry of entries) {
    const single = extractAttrPrimitive(entry.value);
    if (single) out.push(single);
    if (Array.isArray(entry.values)) {
      for (const value of entry.values) {
        const v = extractAttrPrimitive(value);
        if (v) out.push(v);
      }
    }
  }
  return [...new Set(out)];
};

const compactObject = (obj = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    out[key] = value;
  }
  return out;
};

const parseRooms = (attrsIndex) => {
  const directNumber = toInt(getAttrText(attrsIndex, [
    'number_of_rooms',
    'rooms',
    'bedrooms',
    'rooms_number',
    'room_count'
  ]));

  const roomsSlugRaw = normalize(getAttrText(attrsIndex, [
    'number_of_rooms_string',
    'rooms_number_string',
    'rooms_label'
  ]));
  const roomsSlug = roomsSlugRaw.toLowerCase();
  const fromSlugMap = roomsSlug ? toInt(ROOM_SLUG_TO_NUMBER[roomsSlug]) : null;
  const fromSlugDigits = (() => {
    if (!roomsSlug) return null;
    const m = roomsSlug.match(/(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const layout = normalize(getAttrText(attrsIndex, ['layout'])).toLowerCase();
  const layoutStudio = ['studio', 'студия', 'студія'].includes(layout);

  const fromSlugWords = (() => {
    if (!roomsSlug) return null;
    if (/odn|одно|one|single|1/.test(roomsSlug)) return 1;
    if (/dvuh|двух|dvu|дво|two|2/.test(roomsSlug)) return 2;
    if (/treh|трех|tri|three|3/.test(roomsSlug)) return 3;
    if (/chety|четыр|four|4/.test(roomsSlug)) return 4;
    if (/pyat|пят|five|5/.test(roomsSlug)) return 5;
    if (/6|six|bolee|more/.test(roomsSlug)) return 6;
    return null;
  })();

  let rooms = directNumber ?? fromSlugMap ?? fromSlugDigits ?? fromSlugWords;
  if (!rooms && layoutStudio) rooms = 1;
  return Number.isFinite(rooms) && rooms > 0 ? rooms : null;
};

const parseAreaM2 = (attrsIndex) => {
  const raw = getAttrText(attrsIndex, [
    'total_area',
    'area',
    'area_m2',
    'm2',
    'living_area',
    'house_area',
    'property_area',
    'building_area'
  ]);
  const value = toNumber(raw);
  return Number.isFinite(value) ? value : null;
};

const parseFloor = (attrsIndex) => {
  const raw = getAttrText(attrsIndex, [
    'floor',
    'floor_number',
    'floor_no',
    'floor_num',
    'storey'
  ]);
  return toInt(raw);
};

const parseBuildingFloors = (attrsIndex) => {
  const raw = getAttrText(attrsIndex, ['total_floors', 'floors_total', 'building_floors', 'number_of_floors', 'storeys']);
  return toInt(raw);
};

const parseBathrooms = (attrsIndex) => {
  const raw = getAttrText(attrsIndex, [
    'bathroom',
    'bathroom_3',
    'bathroom_5'
  ]);
  const num = toInt(raw);
  if (Number.isFinite(num) && num > 0) return num;
  const bool = normalize(raw).toLowerCase();
  if (['yes', 'true', '1', 'так', 'да'].includes(bool)) return 1;
  return null;
};

const parseRepair = (attrsIndex) => {
  const explicit = getAttrText(attrsIndex, ['repair']);
  if (explicit) return explicit;
  const repaired = normalize(getAttrText(attrsIndex, ['is_repaired'])).toLowerCase();
  if (['yes', 'true', '1', 'так', 'да'].includes(repaired)) return 'repaired';
  if (['no', 'false', '0', 'ні', 'нет'].includes(repaired)) return 'needs_repair';
  return null;
};

const containsAnyToken = (text, regexList = []) => {
  const source = String(text || '').toLowerCase();
  if (!source) return false;
  return regexList.some((re) => re.test(source));
};

const parseComfortFlags = (attrsIndex, advert = {}) => {
  const comfortValues = [
    ...getAttrList(attrsIndex, ['comfort']),
    ...getAttrList(attrsIndex, ['balcony', 'loggia', 'parking'])
  ].join(' | ').toLowerCase();

  const titleDesc = `${normalize(advert?.title)} ${normalize(advert?.description)}`.toLowerCase();

  const hasBalcony =
    containsAnyToken(comfortValues, [/balcon/, /balcony/, /loggi/, /лодж/, /балкон/]) ||
    containsAnyToken(titleDesc, [/балкон/, /лодж/, /balcony/, /loggia/]);

  const hasParking =
    containsAnyToken(comfortValues, [/parking/, /garage/, /паркинг/, /гараж/]) ||
    containsAnyToken(titleDesc, [/паркинг/, /parking/, /garage/, /гараж/]);

  return {
    hasBalcony,
    hasParking
  };
};

const resolveDistrictName = (location = {}, attrsIndex) => {
  const districtId = location?.district_id;
  const byId = districtId != null
    ? getCfgMapValue(DISTRICT_CONFIG?.by_district_id, String(districtId))
    : null;
  if (normalize(byId)) return normalize(byId);

  const fromAttrs = getAttrText(attrsIndex, ['district', 'district_name', 'raion', 'rayon']);
  if (fromAttrs) return fromAttrs;
  return null;
};

const resolveNeighborhood = (attrsIndex) => {
  const fromAttrs = getAttrText(attrsIndex, [
    'neighborhood',
    'microdistrict',
    'subdistrict',
    'district_neighborhood'
  ]);
  return fromAttrs || null;
};

const resolveCityName = (location = {}) => {
  const cityId = location?.city_id;
  const byId = cityId != null
    ? getCfgMapValue(DISTRICT_CONFIG?.by_city_id, String(cityId))
    : null;
  if (normalize(byId)) return normalize(byId);
  return null;
};

const resolveCategoryMapping = (advert = {}, attrsIndex) => {
  const categoryId = advert?.category_id;
  const mapValue = categoryId != null
    ? getCfgMapValue(CATEGORY_CONFIG?.by_category_id, String(categoryId))
    : null;

  let operation = normalize(mapValue?.operation).toLowerCase();
  let propertyType = normalize(mapValue?.property_type).toLowerCase();

  const fullText = `${normalize(advert?.title)} ${normalize(advert?.description)}`.toLowerCase();
  const contractType = getAttrList(attrsIndex, ['contract_type']).join(' ').toLowerCase();

  if (!operation) {
    const isRent =
      containsAnyToken(fullText, [/\brent\b/, /аренд/, /оренд/, /сдам/]) ||
      containsAnyToken(contractType, [/rent/, /lease/]);
    operation = isRent ? 'rent' : DEFAULTS.operation;
  }

  if (!propertyType) {
    if (getAttrText(attrsIndex, ['property_type_houses'])) {
      propertyType = 'house';
    } else if (containsAnyToken(fullText, [/коммерц/, /commercial/, /office/, /shop/, /склад/])) {
      propertyType = 'commercial';
    } else {
      propertyType = DEFAULTS.propertyType;
    }
  }

  return {
    operation,
    propertyType
  };
};

const extractImages = (advert = {}) => {
  const list = Array.isArray(advert?.images) ? advert.images : [];
  return list
    .map((item) => normalize(item?.url))
    .filter(Boolean);
};

export function convertPriceToUsd(rawValue, rawCurrency) {
  const amount = toNumber(rawValue);
  if (!Number.isFinite(amount)) return null;
  const currency = normalize(rawCurrency || FX_CONFIG?.base || 'USD').toUpperCase();
  const rate = Number(FX_CONFIG?.rates_to_usd?.[currency]);
  if (Number.isFinite(rate) && rate > 0) {
    return Math.round(amount * rate);
  }
  return Math.round(amount);
}

export function normalizeOlxAdvert(advert = {}, clientId) {
  const olxId = normalize(advert?.id);
  if (!olxId) return null;

  const status = normalize(advert?.status).toLowerCase();
  const attrsIndex = buildAttributesIndex(advert?.attributes);
  const location = advert?.location && typeof advert.location === 'object' ? advert.location : {};

  const { operation, propertyType } = resolveCategoryMapping(advert, attrsIndex);
  const rooms = parseRooms(attrsIndex);
  const areaM2 = parseAreaM2(attrsIndex);
  const floor = parseFloor(attrsIndex);
  const bathrooms = parseBathrooms(attrsIndex);
  const buildingFloors = parseBuildingFloors(attrsIndex);
  const districtName = resolveDistrictName(location, attrsIndex);
  const neighborhood = resolveNeighborhood(attrsIndex);
  const cityLabel = resolveCityName(location);
  const { hasBalcony, hasParking } = parseComfortFlags(attrsIndex, advert);

  const zkh = getAttrText(attrsIndex, ['zkh']);
  const street = getAttrText(attrsIndex, ['street_address']) || normalize(location?.street) || null;
  const kitchenArea = toNumber(getAttrText(attrsIndex, ['kitchen_area']));
  const heating = getAttrText(attrsIndex, ['heating']);
  const repair = parseRepair(attrsIndex);
  const infrastructure = getAttrList(attrsIndex, ['infrastructure_within_500_meters']).join(', ') || null;
  const landscape = getAttrList(attrsIndex, ['landscape_within_1_km']).join(', ') || null;

  // Group 2: display specs for back-side/tab UI
  const displaySpecs = compactObject({
    street,
    complex: zkh || null,
    kitchen_area: Number.isFinite(kitchenArea) ? kitchenArea : null,
    total_floors: buildingFloors,
    heating,
    repair,
    infrastructure,
    landscape
  });

  const priceAmountUsd = convertPriceToUsd(advert?.price?.value, advert?.price?.currency);
  const images = extractImages(advert);
  const media = images.map((url) => ({ type: 'image', url }));

  const geo = compactObject({
    cityId: toInt(location?.city_id),
    districtId: toInt(location?.district_id),
    latitude: toNumber(location?.latitude),
    longitude: toNumber(location?.longitude),
    city: cityLabel,
    district: districtName,
    neighborhood,
    address: street
  });

  const features = compactObject({
    source: 'olx',
    olxStatus: status || null,
    rooms,
    areaM2,
    floor,
    bathrooms,
    balcony: hasBalcony,
    parking: hasParking,
    has_balcony: hasBalcony,
    has_parking: hasParking,
    complex: zkh || null,
    zkh: zkh || null,
    display_specs: Object.keys(displaySpecs).length ? displaySpecs : null,
    apartments_dev_type: getAttrText(attrsIndex, ['apartments_dev_type']),
    contract_type: getAttrList(attrsIndex, ['contract_type']).join(', ') || null,
    pets: getAttrList(attrsIndex, ['pets']).join(', ') || null,
    furnish: getAttrText(attrsIndex, ['furnish']),
    layout: getAttrText(attrsIndex, ['layout']),
    bathroom: getAttrText(attrsIndex, ['bathroom'])
  });

  // Group 3: full OLX payload in raw
  const raw = {
    source: 'olx',
    importedAt: new Date().toISOString(),
    advert
  };

  return {
    // Group 1 (active/filter fields)
    clientId,
    externalId: `OLX_${olxId}`,
    operation,
    propertyType,
    districtName,
    priceAmountUsd,
    rooms,
    areaM2,
    floor,
    hasBalcony,
    hasParking,
    zkh: zkh || null,

    // Shared card/body fields
    title: normalize(advert?.title) || null,
    description: normalize(advert?.description) || null,
    cityLabel: cityLabel || null,
    neighborhood: neighborhood || null,
    address: street,
    buildingFloors,
    images,
    geo,
    features,
    media,
    raw,
    isActive: ACTIVE_STATUSES.has(status)
  };
}

async function upsertPropertyFromOlx(mapped) {
  const result = await pool.query(
    `
    INSERT INTO properties (
      client_id,
      external_id,
      operation,
      property_type,
      price_amount,
      price_currency,
      geo,
      features,
      media,
      location_city,
      location_district,
      location_neighborhood,
      location_address,
      building_floors,
      specs_rooms,
      specs_area_m2,
      specs_floor,
      specs_balcony,
      title,
      description,
      images,
      raw,
      is_active
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23
    )
    ON CONFLICT (client_id, external_id) DO UPDATE
    SET
      operation = EXCLUDED.operation,
      property_type = EXCLUDED.property_type,
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      geo = EXCLUDED.geo,
      features = EXCLUDED.features,
      media = EXCLUDED.media,
      location_city = EXCLUDED.location_city,
      location_district = EXCLUDED.location_district,
      location_neighborhood = EXCLUDED.location_neighborhood,
      location_address = EXCLUDED.location_address,
      building_floors = EXCLUDED.building_floors,
      specs_rooms = EXCLUDED.specs_rooms,
      specs_area_m2 = EXCLUDED.specs_area_m2,
      specs_floor = EXCLUDED.specs_floor,
      specs_balcony = EXCLUDED.specs_balcony,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      images = EXCLUDED.images,
      raw = EXCLUDED.raw,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING id, client_id, external_id
    `,
    [
      mapped.clientId,
      mapped.externalId,
      mapped.operation,
      mapped.propertyType,
      mapped.priceAmountUsd,
      'USD',
      JSON.stringify(mapped.geo || {}),
      JSON.stringify(mapped.features || {}),
      JSON.stringify(mapped.media || []),
      mapped.cityLabel,
      mapped.districtName,
      mapped.neighborhood,
      mapped.address,
      mapped.buildingFloors,
      mapped.rooms,
      mapped.areaM2,
      mapped.floor,
      mapped.hasBalcony,
      mapped.title,
      mapped.description,
      JSON.stringify(mapped.images || []),
      JSON.stringify(mapped.raw || {}),
      mapped.isActive
    ]
  );
  return result.rows?.[0] || null;
}

async function fetchAdvertsPage(accessToken, { offset = 0, limit = 100 } = {}) {
  const url = new URL(`${OLX_PARTNER_BASE()}/adverts`);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: '2.0',
      Accept: 'application/json'
    }
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    payload: payload && typeof payload === 'object' ? payload : {},
    rawText: text
  };
}

async function fetchAllAdverts(accessToken) {
  const all = [];
  const pageSize = 100;
  let offset = 0;
  // Safety cap
  const hardLimit = 2000;

  while (all.length < hardLimit) {
    const page = await fetchAdvertsPage(accessToken, { offset, limit: pageSize });
    if (!page.ok) {
      const reason = page?.payload?.error || page?.rawText || `HTTP_${page.status}`;
      throw new Error(`OLX_ADVERTS_FETCH_FAILED:${page.status}:${reason}`);
    }
    const data = Array.isArray(page?.payload?.data) ? page.payload.data : [];
    if (!data.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

export async function syncOlxAdvertsForAdmin({
  clientId,
  tgUserId
}) {
  const credentials = await getOlxIntegrationCredentials({ clientId, tgUserId });
  if (!credentials?.access_token) {
    throw new Error('OLX_NOT_CONNECTED');
  }

  let accessToken = normalize(credentials.access_token);
  let refreshToken = normalize(credentials.refresh_token);
  let adverts;

  try {
    adverts = await fetchAllAdverts(accessToken);
  } catch (error) {
    const canRefresh =
      String(error?.message || '').includes('401') &&
      Boolean(refreshToken);
    if (!canRefresh) throw error;

    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = normalize(refreshed?.access_token);
    refreshToken = normalize(refreshed?.refresh_token) || refreshToken;
    if (!accessToken) {
      throw new Error('OLX_REFRESH_NO_ACCESS_TOKEN');
    }

    await upsertOlxIntegration({
      clientId,
      tgUserId,
      olxUserId: credentials?.olx_user_id || null,
      accessToken,
      refreshToken,
      tokenType: normalize(refreshed?.token_type) || null,
      scope: normalize(refreshed?.scope) || null,
      expiresIn: refreshed?.expires_in,
      rawTokenPayload: refreshed
    });

    adverts = await fetchAllAdverts(accessToken);
  }

  let imported = 0;
  for (const advert of adverts) {
    const mapped = normalizeOlxAdvert(advert, clientId);
    if (!mapped?.externalId || mapped.externalId === 'OLX_') continue;
    await upsertPropertyFromOlx(mapped);
    imported += 1;
  }

  return {
    totalFetched: adverts.length,
    imported,
    skipped: Math.max(0, adverts.length - imported)
  };
}
