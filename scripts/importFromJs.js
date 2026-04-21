// scripts/importFromJs.js

import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../services/db.js';
import * as propertiesModule from '../data/properties.js';

// Просто чтобы проверить, что скрипт вообще запустился
console.log('🚀 Запуск скрипта импорта из properties.js...');

// Пытаемся аккуратно вытащить массив объектов из модуля
const properties =
  propertiesModule.default ||
  propertiesModule.properties ||
  propertiesModule.data ||
  propertiesModule;

const CLIENT_ID = process.env.IMPORT_CLIENT_ID || process.env.APP_CLIENT_ID || 'demo';

if (!Array.isArray(properties)) {
  console.error('❌ Ожидался массив properties, а получил:', typeof properties);
  process.exit(1);
}

async function importProperties() {
  console.log(`ℹ️ Импортируем ${properties.length} объектов для клиента "${CLIENT_ID}"...`);

  
  // Сначала очищаем старые объекты этого клиента
  await pool.query('DELETE FROM properties WHERE client_id = $1', [CLIENT_ID]);

  let count = 0;

  // helpers
  const toText = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' || s.toLowerCase() === 'null' ? null : s;
  };
  const cleanId = (v) => {
    const s = toText(v);
    return s ? s.toUpperCase() : null;
  };

  for (const pRaw of properties) {
    // нормализуем сырой объект на минимальном уровне
    const p = { ...pRaw };
    const price = p.price || {};
    const loc = p.location || {};
    const building = p.building || {};
    const specs = p.specs || {};

    const images = Array.isArray(p.images) ? p.images : [];
    const now = new Date();
    // Подготовим JSON-поля для вставки (строки JSON)
    const infraJson = building.infrastructure ? JSON.stringify(building.infrastructure) : null;
    const imagesJson = JSON.stringify(images || []);
    const rawJson = JSON.stringify(pRaw);
    const externalId = cleanId(p.id);

    await pool.query(
      `
      INSERT INTO properties (
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
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16,
        $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27, $28, $29
      )
      `,
      [
        CLIENT_ID,
        externalId,
        toText(p.operation),
        toText(p.property_type),
        p.furnished ?? null,

        price.amount ?? null,
        toText(price.currency) || 'EUR',
        p.price_per_m2 ?? null,

        toText(loc.country) || 'ES',
        toText(loc.city),
        toText(loc.district),
        toText(loc.neighborhood),
        toText(loc.address),

        building.year ?? null,
        building.floors ?? null,
        infraJson,

        specs.rooms ?? null,
        specs.bathrooms ?? null,
        specs.area_m2 ?? null,
        specs.floor ?? null,
        specs.balcony ?? null,
        specs.terrace ?? null,

        toText(p.title),
        toText(p.description),
        imagesJson,
        rawJson,              // raw JSON целиком
        true,           // is_active
        now,
        now
      ]
    );

    count++;
  }

  console.log(`✅ Импорт завершён. Добавлено ${count} объектов для клиента "${CLIENT_ID}".`);
}

(async () => {
  try {
    await importProperties();
  } catch (err) {
    console.error('❌ Ошибка при импорте свойств:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
