import fetch from 'node-fetch';
import xml2js from 'xml2js';
import { pool } from './db.js';
import { ensureResidentialComplexes } from './residentialComplexesRepository.js';

const DOMSTAR_CLIENT_ID = 'domstar';
const DOMSTAR_FEED_URL = 'https://crm-domstar-od.realtsoft.net/feed/xml?id=10';

const toText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object' && value._ !== undefined) return String(value._).trim();
  return '';
};

const toNumber = (value) => {
  const text = toText(value).replace(',', '.');
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
};

const toInt = (value) => {
  const num = toNumber(value);
  return Number.isFinite(num) ? Math.round(num) : null;
};

const toBoolYes = (value) => {
  const text = toText(value).toLowerCase();
  return ['так', 'да', 'yes', 'true', '1'].includes(text);
};

const compactObject = (obj) => Object.fromEntries(
  Object.entries(obj).filter(([, value]) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  })
);

const arrayOf = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const stripDistrictSuffix = (value) => toText(value)
  .replace(/\s+район$/i, '')
  .replace(/\s+р-н$/i, '')
  .trim();

const normalizeAdministrativeDistrict = (value) => {
  const raw = stripDistrictSuffix(value);
  const lower = raw.toLowerCase();
  if (!lower) return '';
  if (lower.includes('примор')) return 'Приморский';
  if (lower.includes('київ') || lower.includes('киев') || lower.includes('лиманк')) return 'Киевский';
  if (lower.includes('малинов') || lower.includes('хаджиб')) return 'Малиновский';
  if (lower.includes('суворов') || lower.includes('перес')) return 'Суворовский';
  return raw;
};

const sameLoose = (a, b) => {
  const normalize = (value) => stripDistrictSuffix(value)
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const left = normalize(a);
  const right = normalize(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
};

const mapPropertyType = (rawType, rawCategory) => {
  const type = toText(rawType).toLowerCase();
  const category = toText(rawCategory).toLowerCase();

  if (type.includes('земля') || category.includes('земель')) return 'land';
  if ([
    'будинок',
    'таунхаус',
    'дуплекс',
    'вілла'
  ].some((token) => type.includes(token))) return 'house';
  if ([
    'офіс',
    'торгівельна',
    'магазин',
    'склад',
    'будівля',
    'паркування',
    'сфера',
    'готельний',
    "інший об'єкт"
  ].some((token) => type.includes(token)) || category.includes('комерц')) return 'commercial';
  return 'apartment';
};

const mapOperation = (rawDeal) => {
  const deal = toText(rawDeal).toLowerCase();
  if (deal.includes('оренд') || deal.includes('аренд')) return 'rent';
  return 'sale';
};

const getPropertyOptions = (item) => {
  const options = arrayOf(item?.properties?.property);
  return options.map((option) => ({
    label: toText(option?.$?.label),
    attribute: toText(option?.$?.attribute),
    value: toText(option)
  })).filter((option) => option.label || option.value || option.attribute);
};

const getOptionValue = (options, labelNeedle) => {
  const needle = String(labelNeedle || '').trim().toLowerCase();
  const found = options.find((option) => option.label.toLowerCase().includes(needle));
  return found?.value || '';
};

const hasGovernmentProgram = (options) => {
  const value = getOptionValue(options, 'госс');
  return toBoolYes(value);
};

const getImages = (item) => arrayOf(item?.images?.image_url)
  .map(toText)
  .filter((url) => /^https?:\/\//i.test(url));

const mapDomstarItem = (item, { url = DOMSTAR_FEED_URL, clientId = DOMSTAR_CLIENT_ID } = {}) => {
  const internalId = toText(item?.$?.['internal-id'] || item?.article);
  if (!internalId) return null;

  const location = item?.location || {};
  const category = toText(item?.category);
  const realtyType = toText(item?.realty_type);
  const propertyType = mapPropertyType(realtyType, category);
  const operation = mapOperation(item?.deal);
  const options = getPropertyOptions(item);
  const governmentProgram = hasGovernmentProgram(options);
  const images = getImages(item);
  const media = images.map((imageUrl) => ({ type: 'image', url: imageUrl }));
  const areaM2 = toNumber(item?.area_total);
  const landAreaSotka = toNumber(item?.area_land);
  const rooms = toInt(item?.room_count);
  const floor = toInt(item?.floor);
  const buildingFloors = toInt(item?.total_floors);
  const rcName = toText(item?.newbuilding_name);
  const boroughRu = toText(location?.borough_ru) || toText(location?.borough);
  const districtRu = toText(location?.district_ru) || toText(location?.district);
  const district = normalizeAdministrativeDistrict(boroughRu || districtRu);
  const neighborhood = districtRu && !sameLoose(districtRu, boroughRu) ? stripDistrictSuffix(districtRu) : '';
  const street = toText(location?.street_ru) || toText(location?.street);
  const streetType = toText(location?.street_type_ru) || toText(location?.street_type);
  const address = [streetType, street].filter(Boolean).join(' ').trim();
  const priceAmount = toInt(item?.price);
  const priceCurrency = toText(item?.price?.$?.currency) || 'USD';
  const title = toText(item?.title);
  const description = toText(item?.description);

  const geo = compactObject({
    city: toText(location?.city_ru) || toText(location?.city) || 'Одеса',
    district,
    neighborhood,
    address,
    country: toText(location?.country),
    region: toText(location?.region_ru) || toText(location?.region),
    latitude: toNumber(location?.map_lat),
    longitude: toNumber(location?.map_lng)
  });

  const displaySpecs = compactObject({
    realtyType,
    category,
    total_floors: buildingFloors,
    land_area_sotka: landAreaSotka,
    living_area_m2: toNumber(item?.area_living),
    kitchen_area_m2: toNumber(item?.area_kitchen),
    repair: getOptionValue(options, 'ремонту') || getOptionValue(options, 'ремонт'),
    layout: getOptionValue(options, 'Планировка'),
    heating: getOptionValue(options, 'Отопление'),
    buildingType: getOptionValue(options, 'Тип дома') || getOptionValue(options, 'Тип здания')
  });

  const features = compactObject({
    source: 'domstar_xml',
    status: toText(item?.status),
    article: toText(item?.article),
    realtyType,
    category,
    rooms,
    areaM2,
    landAreaSotka,
    land_area_sotka: landAreaSotka,
    floor,
    buildingFloors,
    total_floors: buildingFloors,
    complex: rcName,
    zkh: rcName,
    residentialComplex: Boolean(rcName),
    governmentProgram,
    governmentPrograms: governmentProgram ? ['government_program'] : null,
    display_specs: Object.keys(displaySpecs).length ? displaySpecs : null,
    domstarProperties: options
  });

  return {
    clientId,
    externalId: `DOMSTAR_${internalId}`,
    operation,
    propertyType,
    priceAmount,
    priceCurrency,
    geo,
    features,
    media,
    city: geo.city || 'Одеса',
    district: geo.district || null,
    neighborhood: geo.neighborhood || null,
    address: geo.address || null,
    buildingFloors,
    rooms,
    areaM2,
    floor,
    title,
    description,
    images,
    raw: {
      source: 'domstar_xml',
      importedAt: new Date().toISOString(),
      original_url: url,
      item
    },
    isActive: toText(item?.status).toLowerCase() === 'active'
  };
};

async function upsertDomstarProperty(mapped) {
  const { rows } = await pool.query(
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
      title,
      description,
      images,
      raw,
      is_active
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::numeric,$17,$18,$19,$20::jsonb,$21::jsonb,$22
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
      mapped.priceAmount,
      mapped.priceCurrency,
      JSON.stringify(mapped.geo || {}),
      JSON.stringify(mapped.features || {}),
      JSON.stringify(mapped.media || []),
      mapped.city,
      mapped.district,
      mapped.neighborhood,
      mapped.address,
      mapped.buildingFloors,
      mapped.rooms,
      mapped.areaM2,
      mapped.floor,
      mapped.title || null,
      mapped.description || null,
      JSON.stringify(mapped.images || []),
      JSON.stringify(mapped.raw || {}),
      mapped.isActive
    ]
  );
  return rows?.[0] || null;
}

export async function parseAndImportDomstarXml({
  url = DOMSTAR_FEED_URL,
  clientId = DOMSTAR_CLIENT_ID
} = {}) {
  const safeClientId = String(clientId || DOMSTAR_CLIENT_ID).trim() || DOMSTAR_CLIENT_ID;
  console.log(`[domstar-xml] Fetching XML from ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DOMSTAR_XML_FETCH_FAILED_${response.status}`);
  }
  const xmlData = await response.text();
  const result = await new xml2js.Parser({ explicitArray: false, ignoreAttrs: false }).parseStringPromise(xmlData);
  const items = arrayOf(result?.response?.item);
  console.log(`[domstar-xml] Found ${items.length} items.`);

  const rcNames = [...new Set(items.map((item) => toText(item?.newbuilding_name)).filter(Boolean))];
  if (rcNames.length > 0) {
    console.log(`[domstar-xml] Ensuring ${rcNames.length} unique Residential Complexes...`);
    await ensureResidentialComplexes(safeClientId, rcNames);
  }

  const stats = {
    total: items.length,
    imported: 0,
    skipped: 0,
    byType: {},
    withImages: 0,
    withLandArea: 0,
    withGovernmentProgram: 0,
    withResidentialComplex: 0
  };

  for (const item of items) {
    const mapped = mapDomstarItem(item, { url, clientId: safeClientId });
    if (!mapped) {
      stats.skipped++;
      continue;
    }
    await upsertDomstarProperty(mapped);
    stats.imported++;
    stats.byType[mapped.propertyType] = (stats.byType[mapped.propertyType] || 0) + 1;
    if (mapped.images.length) stats.withImages++;
    if (mapped.features.landAreaSotka != null) stats.withLandArea++;
    if (mapped.features.governmentProgram === true) stats.withGovernmentProgram++;
    if (mapped.features.complex) stats.withResidentialComplex++;
    if (stats.imported % 100 === 0) {
      console.log(`[domstar-xml] Imported ${stats.imported}/${items.length}...`);
    }
  }

  console.log('[domstar-xml] Import complete:', JSON.stringify(stats, null, 2));
  return stats;
}

export {
  DOMSTAR_CLIENT_ID,
  DOMSTAR_FEED_URL,
  mapDomstarItem
};
