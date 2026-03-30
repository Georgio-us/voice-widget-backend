import { pool } from './db.js';
import {
  getOlxIntegrationCredentials,
  upsertOlxIntegration
} from './olxIntegrationRepository.js';
import { refreshAccessToken } from './olxOAuthService.js';

const normalize = (value) => String(value || '').trim();
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const OLX_PARTNER_BASE = () =>
  normalize(process.env.OLX_PARTNER_API_BASE) || 'https://www.olx.ua/api/partner';

const ACTIVE_STATUSES = new Set(['new', 'active', 'limited', 'unconfirmed', 'unpaid', 'moderated']);

function pickAttributeNumber(attributes = [], candidates = []) {
  if (!Array.isArray(attributes) || !attributes.length) return null;
  const normalizedCandidates = candidates.map((c) => normalize(c).toLowerCase());
  for (const attr of attributes) {
    const code = normalize(attr?.code).toLowerCase();
    if (!code || !normalizedCandidates.includes(code)) continue;
    const direct = toNumber(attr?.value);
    if (direct != null) return direct;
    const fromValues = Array.isArray(attr?.values) ? toNumber(attr.values[0]) : null;
    if (fromValues != null) return fromValues;
  }
  return null;
}

function extractImages(advert = {}) {
  const list = Array.isArray(advert?.images) ? advert.images : [];
  return list
    .map((item) => normalize(item?.url))
    .filter(Boolean);
}

function mapAdvertToProperty(advert = {}, clientId) {
  const olxId = normalize(advert?.id);
  const externalId = `OLX_${olxId}`;
  const status = normalize(advert?.status).toLowerCase();
  const images = extractImages(advert);
  const priceAmount = toNumber(advert?.price?.value);
  const priceCurrency = normalize(advert?.price?.currency) || 'UAH';
  const attributes = Array.isArray(advert?.attributes) ? advert.attributes : [];

  const rooms = pickAttributeNumber(attributes, ['rooms', 'number_of_rooms', 'bedrooms']);
  const areaM2 = pickAttributeNumber(attributes, ['area', 'area_m2', 'm2']);
  const floor = pickAttributeNumber(attributes, ['floor']);
  const districtId = toNumber(advert?.location?.district_id);
  const cityId = toNumber(advert?.location?.city_id);

  const geo = {
    cityId,
    districtId,
    latitude: toNumber(advert?.location?.latitude),
    longitude: toNumber(advert?.location?.longitude)
  };
  const features = {
    source: 'olx',
    olxStatus: status || null,
    rooms: rooms != null ? Math.round(rooms) : null,
    areaM2: areaM2 != null ? Number(areaM2) : null,
    floor: floor != null ? Math.round(floor) : null
  };
  const media = images.map((url) => ({ type: 'image', url }));
  const raw = {
    source: 'olx',
    importedAt: new Date().toISOString(),
    advert
  };

  return {
    clientId,
    externalId,
    title: normalize(advert?.title) || null,
    description: normalize(advert?.description) || null,
    priceAmount: priceAmount != null ? Math.round(priceAmount) : null,
    priceCurrency,
    rooms: rooms != null ? Math.round(rooms) : null,
    areaM2: areaM2 != null ? Number(areaM2) : null,
    floor: floor != null ? Math.round(floor) : null,
    cityLabel: null,
    districtLabel: null,
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
      specs_rooms,
      specs_area_m2,
      specs_floor,
      title,
      description,
      images,
      raw,
      is_active
    ) VALUES (
      $1,$2,'sale','apartment',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17
    )
    ON CONFLICT (client_id, external_id) DO UPDATE
    SET
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      geo = EXCLUDED.geo,
      features = EXCLUDED.features,
      media = EXCLUDED.media,
      location_city = EXCLUDED.location_city,
      location_district = EXCLUDED.location_district,
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
      mapped.priceAmount,
      mapped.priceCurrency,
      JSON.stringify(mapped.geo || {}),
      JSON.stringify(mapped.features || {}),
      JSON.stringify(mapped.media || []),
      mapped.cityLabel,
      mapped.districtLabel,
      mapped.rooms,
      mapped.areaM2,
      mapped.floor,
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
    const mapped = mapAdvertToProperty(advert, clientId);
    if (!mapped.externalId || mapped.externalId === 'OLX_') continue;
    await upsertPropertyFromOlx(mapped);
    imported += 1;
  }

  return {
    totalFetched: adverts.length,
    imported,
    skipped: Math.max(0, adverts.length - imported)
  };
}
