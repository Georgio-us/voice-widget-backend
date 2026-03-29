// services/propertiesRepository.js
import { pool } from './db.js';

const DEFAULT_CLIENT_ID = 'demo';

// Получить все квартиры для клиента (пока используем только demo)
// ✅ Возвращаем КОЛОНКИ таблицы (а не raw), чтобы типы были корректные (int/bool/json)
// ✅ Сортируем так, чтобы свежедобавленные попадали в limit=10
export async function getAllProperties(clientId = DEFAULT_CLIENT_ID) {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      client_id,
      external_id,
      operation,
      property_type,
      price_period,
      furnished,
      price_amount,
      price_currency,
      price_per_m2,
      geo,
      features,
      media,
      location_country,
      location_city,
      location_district,
      location_neighborhood,
      location_address,
      building_year,
      building_floors,
      building_infrastructure,
      specs_rooms,
      specs_bathrooms,
      specs_area_m2,
      specs_floor,
      specs_balcony,
      specs_terrace,
      title,
      description,
      images,
      raw,
      is_active,
      created_at,
      updated_at
    FROM properties
    WHERE client_id = $1 AND is_active = true
    ORDER BY created_at DESC, id DESC
    `,
    [clientId]
  );

  return rows;
}

// Получить одну квартиру по external_id (например "A001")
// ✅ TRIM чтобы находило даже если в XLSX случайно прилетели пробелы "A102 "
export async function getPropertyByExternalId(externalId, clientId = DEFAULT_CLIENT_ID) {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      client_id,
      external_id,
      operation,
      property_type,
      price_period,
      furnished,
      price_amount,
      price_currency,
      price_per_m2,
      geo,
      features,
      media,
      location_country,
      location_city,
      location_district,
      location_neighborhood,
      location_address,
      building_year,
      building_floors,
      building_infrastructure,
      specs_rooms,
      specs_bathrooms,
      specs_area_m2,
      specs_floor,
      specs_balcony,
      specs_terrace,
      title,
      description,
      images,
      raw,
      is_active,
      created_at,
      updated_at
    FROM properties
    WHERE client_id = $1
      AND TRIM(external_id) = TRIM($2)
    LIMIT 1
    `,
    [clientId, String(externalId ?? '')]
  );

  if (!rows.length) return null;
  return rows[0];
}

async function getNextManualExternalId(client, clientId = DEFAULT_CLIENT_ID, prefix = 'A') {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`manual_external_id:${clientId}:${prefix}`]);
  const { rows } = await client.query(
    `
    SELECT external_id
    FROM properties
    WHERE client_id = $1
      AND external_id ~ ('^' || $2 || '\\d+$')
    ORDER BY LENGTH(external_id) DESC, external_id DESC
    LIMIT 1
    `,
    [clientId, prefix]
  );
  const current = String(rows?.[0]?.external_id || '').trim();
  const numeric = current ? Number(current.replace(new RegExp(`^${prefix}`), '')) : 0;
  const next = Number.isFinite(numeric) ? numeric + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function createManualProperty(payload = {}, clientId = DEFAULT_CLIENT_ID) {
  const safeClientId = String(clientId || DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID;
  const mode = String(payload.mode || 'publish').trim().toLowerCase();
  const status = mode === 'draft' ? 'draft' : 'active';
  const isActive = status === 'active';
  const operation = String(payload.operation || 'sale').trim() || 'sale';
  const propertyType = String(payload.property_type || 'apartment').trim() || 'apartment';
  const city = String(payload.city || 'Одеса').trim() || 'Одеса';
  const district = String(payload.district || '').trim();
  const neighborhood = String(payload.neighborhood || '').trim();
  const address = String(payload.address || '').trim();
  const title = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();
  const priceAmount = Number(payload.price_amount);
  const rooms = payload.rooms == null || payload.rooms === '' ? null : Number(payload.rooms);
  const floor = payload.floor == null || payload.floor === '' ? null : Number(payload.floor);
  const areaM2 = payload.area_m2 == null || payload.area_m2 === '' ? null : Number(payload.area_m2);
  const buildingFloors = payload.building_floors == null || payload.building_floors === '' ? null : Number(payload.building_floors);
  const balcony = payload.balcony === true;
  const terrace = payload.terrace === true;
  const furnished = payload.furnished === true;
  const images = Array.isArray(payload.images) ? payload.images.filter(Boolean).map((v) => String(v).trim()).filter(Boolean) : [];
  const media = images.map((url) => ({ type: 'image', url }));
  const features = {
    furnished,
    rooms: Number.isFinite(rooms) ? rooms : null,
    areaM2: Number.isFinite(areaM2) ? areaM2 : null,
    floor: Number.isFinite(floor) ? floor : null,
    balcony,
    terrace,
    ...(payload.extraFeatures && typeof payload.extraFeatures === 'object' ? payload.extraFeatures : {})
  };
  const geo = {
    city,
    district: district || null,
    neighborhood: neighborhood || null,
    address: address || null
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const externalId = await getNextManualExternalId(client, safeClientId, 'A');
    const { rows } = await client.query(
      `
      INSERT INTO properties (
        client_id,
        external_id,
        operation,
        property_type,
        furnished,
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
        specs_terrace,
        title,
        description,
        images,
        raw,
        is_active
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25
      )
      RETURNING *
      `,
      [
        safeClientId,
        externalId,
        operation,
        propertyType,
        furnished,
        Number.isFinite(priceAmount) ? Math.round(priceAmount) : null,
        'UAH',
        JSON.stringify(geo),
        JSON.stringify(features),
        JSON.stringify(media),
        city,
        district || null,
        neighborhood || null,
        address || null,
        Number.isFinite(buildingFloors) ? Math.round(buildingFloors) : null,
        Number.isFinite(rooms) ? Math.round(rooms) : null,
        Number.isFinite(areaM2) ? Math.round(areaM2) : null,
        Number.isFinite(floor) ? Math.round(floor) : null,
        balcony,
        terrace,
        title || null,
        description || null,
        JSON.stringify(images),
        JSON.stringify({ source: 'manual', created_via: 'admin_form', mode, status }),
        isActive
      ]
    );
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
