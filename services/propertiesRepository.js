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
      furnished,
      price_amount,
      price_currency,
      price_per_m2,
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
      furnished,
      price_amount,
      price_currency,
      price_per_m2,
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