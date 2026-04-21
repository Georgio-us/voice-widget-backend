// scripts/importFromCsv.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { pool } from '../services/db.js';

const CLIENT_ID = process.env.IMPORT_CLIENT_ID || process.env.APP_CLIENT_ID || 'demo';

// usage:
// node scripts/importFromCsv.js ./data/import/properties.csv
const csvPathArg = process.argv[2];
if (!csvPathArg) {
  console.error('❌ Укажи путь к CSV: node scripts/importFromCsv.js ./path/to/file.csv');
  process.exit(1);
}

const csvPath = path.resolve(process.cwd(), csvPathArg);
if (!fs.existsSync(csvPath)) {
  console.error('❌ CSV файл не найден:', csvPath);
  process.exit(1);
}

console.log('🚀 Запуск импорта из CSV...');
console.log('ℹ️ client_id =', CLIENT_ID);
console.log('ℹ️ csv =', csvPath);

// Нормализация значений
const toInt = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};
const toBool = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'null') return null;
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
};
const toText = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s;
};
const cleanId = (v) => {
  const s = toText(v);
  return s ? s.toUpperCase() : null;
};
const toJsonArray = (v) => {
  // 1) JSON array: ["a","b"]
  // 2) or comma/semicolon separated: a,b,c
  const s = toText(v);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  // split fallback
  return s.split(/[;,]/g).map(x => x.trim()).filter(Boolean);
};
const toJsonObject = (v) => {
  const s = toText(v);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    // если не JSON — вернём как строку в объекте, чтобы не ронять импорт
    return { value: s };
  }
};

const csvRaw = fs.readFileSync(csvPath, 'utf8');
const records = parse(csvRaw, {
  columns: true,
  skip_empty_lines: true,
  trim: true
});

if (!records.length) {
  console.log('ℹ️ CSV пустой — нечего импортировать.');
  process.exit(0);
}

console.log(`ℹ️ Найдено строк: ${records.length}`);

// Важно: мы НЕ делаем DELETE всей базы.
// Мы делаем UPSERT по (client_id, external_id)
// => можно докидывать новые 80 и не терять старые.
async function ensureUniqueIndex() {
  // если индекса нет — сделаем. (безопасно, если уже есть)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'properties_client_external_uidx'
      ) THEN
        CREATE UNIQUE INDEX properties_client_external_uidx
        ON properties (client_id, external_id);
      END IF;
    END $$;
  `);
}

async function importCsv() {
  await ensureUniqueIndex();

  let insertedOrUpdated = 0;

  for (const row of records) {
    const now = new Date();

    // Минимально обязателен external_id (типа A001 / 123 / etc)
    const externalId = cleanId(row.external_id || row.id || row.externalId);
    if (!externalId) {
      console.warn('⚠️ Пропуск строки без external_id:', row);
      continue;
    }

    // Подготовим raw — сохраняем оригинальную строку CSV как есть
    const rawJson = JSON.stringify(row);

    // building_infrastructure / images — JSON колонки
    const buildingInfra = row.building_infrastructure ?? row.infrastructure ?? row.infra;
    const infraJson = buildingInfra ? JSON.stringify(toJsonArray(buildingInfra)) : null;

    const imagesArr = toJsonArray(row.images || row.image_urls || row.imageUrl || row.image);
    const imagesJson = JSON.stringify(imagesArr);

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
      ON CONFLICT (client_id, external_id) DO UPDATE SET
        operation = EXCLUDED.operation,
        property_type = EXCLUDED.property_type,
        furnished = EXCLUDED.furnished,
        price_amount = EXCLUDED.price_amount,
        price_currency = EXCLUDED.price_currency,
        price_per_m2 = EXCLUDED.price_per_m2,
        location_country = EXCLUDED.location_country,
        location_city = EXCLUDED.location_city,
        location_district = EXCLUDED.location_district,
        location_neighborhood = EXCLUDED.location_neighborhood,
        location_address = EXCLUDED.location_address,
        building_year = EXCLUDED.building_year,
        building_floors = EXCLUDED.building_floors,
        building_infrastructure = EXCLUDED.building_infrastructure,
        specs_rooms = EXCLUDED.specs_rooms,
        specs_bathrooms = EXCLUDED.specs_bathrooms,
        specs_area_m2 = EXCLUDED.specs_area_m2,
        specs_floor = EXCLUDED.specs_floor,
        specs_balcony = EXCLUDED.specs_balcony,
        specs_terrace = EXCLUDED.specs_terrace,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        images = EXCLUDED.images,
        raw = EXCLUDED.raw,
        is_active = EXCLUDED.is_active,
        updated_at = EXCLUDED.updated_at
      `,
      [
        CLIENT_ID,
        externalId,
        toText(row.operation),
        toText(row.property_type),
        toBool(row.furnished),

        toInt(row.price_amount),
        toText(row.price_currency) || 'EUR',
        toInt(row.price_per_m2),

        toText(row.location_country) || 'ES',
        toText(row.location_city),
        toText(row.location_district),
        toText(row.location_neighborhood),
        toText(row.location_address),

        toInt(row.building_year),
        toInt(row.building_floors),
        infraJson,

        toInt(row.specs_rooms),
        toInt(row.specs_bathrooms),
        toInt(row.specs_area_m2),
        toInt(row.specs_floor),
        toBool(row.specs_balcony),
        toBool(row.specs_terrace),

        toText(row.title),
        toText(row.description),
        imagesJson,
        rawJson,
        true,
        now,
        now
      ]
    );

    insertedOrUpdated++;
  }

  console.log(`✅ Импорт завершён. Обработано: ${insertedOrUpdated} строк (insert/update) для client_id="${CLIENT_ID}".`);
}

(async () => {
  try {
    await importCsv();
  } catch (err) {
    console.error('❌ Ошибка импорта CSV:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
