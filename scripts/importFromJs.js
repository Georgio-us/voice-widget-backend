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

const CLIENT_ID = 'demo';

if (!Array.isArray(properties)) {
  console.error('❌ Ожидался массив properties, а получил:', typeof properties);
  process.exit(1);
}

async function importProperties() {
  console.log(`ℹ️ Импортируем ${properties.length} объектов для клиента "${CLIENT_ID}"...`);

  
  // Сначала очищаем старые объекты этого клиента
  await pool.query('DELETE FROM properties WHERE client_id = $1', [CLIENT_ID]);

  let count = 0;

  for (const p of properties) {
    const price = p.price || {};
    const loc = p.location || {};
    const building = p.building || {};
    const specs = p.specs || {};

    const images = Array.isArray(p.images) ? p.images : [];
    const now = new Date();
    // Подготовим JSON-поля для вставки (строки JSON)
    const infraJson = building.infrastructure ? JSON.stringify(building.infrastructure) : null;
    const imagesJson = JSON.stringify(images || []);
    const rawJson = JSON.stringify(p);

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
        p.id ?? null,
        p.operation ?? null,
        p.property_type ?? null,
        p.furnished ?? null,

        price.amount ?? null,
        price.currency ?? null,
        p.price_per_m2 ?? null,

        loc.country ?? null,
        loc.city ?? null,
        loc.district ?? null,
        loc.neighborhood ?? null,
        loc.address ?? null,

        building.year ?? null,
        building.floors ?? null,
        infraJson,

        specs.rooms ?? null,
        specs.bathrooms ?? null,
        specs.area_m2 ?? null,
        specs.floor ?? null,
        specs.balcony ?? null,
        specs.terrace ?? null,

        p.title ?? null,
        p.description ?? null,
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