// scripts/importFromXlsx.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import { pool } from '../services/db.js';

const CLIENT_ID = process.env.IMPORT_CLIENT_ID || 'demo';

// usage:
// IMPORT_CLIENT_ID="demo" DATABASE_URL="..." node scripts/importFromXlsx.js ./data/properties.xlsx
const xlsxPathArg = process.argv[2];
if (!xlsxPathArg) {
  console.error('❌ Укажи путь к XLSX: node scripts/importFromXlsx.js ./path/to/file.xlsx');
  process.exit(1);
}

const xlsxPath = path.resolve(process.cwd(), xlsxPathArg);
if (!fs.existsSync(xlsxPath)) {
  console.error('❌ XLSX файл не найден:', xlsxPath);
  process.exit(1);
}

console.log('🚀 Запуск импорта из XLSX...');
console.log('ℹ️ client_id =', CLIENT_ID);
console.log('ℹ️ xlsx =', xlsxPath);

// ---------- helpers ----------
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
  let s = String(v);
  // trim обычный + NBSP
  s = s.replace(/\u00A0/g, ' ').trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s;
};
const normalizeOperation = (v) => {
  const s = String(toText(v) || '').toLowerCase();
  if (!s) return null;
  if (s === 'buy') return 'sale';
  if (s === 'sale' || s === 'rent') return s;
  return s;
};
const cleanId = (v) => {
  const s = toText(v);
  return s ? s.toUpperCase() : null;
};
const compactObject = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
};
const toJsonArray = (v) => {
  // 1) JSON array: ["a","b"]
  // 2) или строка с разделителями: a,b,c или a; b; c
  const s = toText(v);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return s.split(/[;,]/g).map(x => x.trim()).filter(Boolean);
};

// Иногда Excel/терминал даёт "Ð¢ÐµÑ..." — попробуем мягко починить
const fixMojibake = (s) => {
  if (!s) return s;
  // грубый признак: много "Ð" или "Ñ"
  const bad = /Ð|Ñ/.test(s);
  if (!bad) return s;
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch {
    return s;
  }
};

const normalizeRowKeys = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    // ключи: убрать пробелы, привести к lower, заменить пробелы на _
    const key = String(k)
      .replace(/\u00A0/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    out[key] = typeof v === 'string' ? fixMojibake(v) : v;
  }
  return out;
};

async function ensureUniqueIndex() {
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

async function importXlsx() {
  await ensureUniqueIndex();

  const wb = xlsx.readFile(xlsxPath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // defval: '' чтобы пустые колонки существовали, а не исчезали
  const rawRows = xlsx.utils.sheet_to_json(ws, { defval: '' });

  console.log(`ℹ️ Найдено строк: ${rawRows.length}`);

  if (!rawRows.length) {
    console.log('ℹ️ XLSX пустой — нечего импортировать.');
    return;
  }

  let insertedOrUpdated = 0;

  for (const rawRow of rawRows) {
    const row = normalizeRowKeys(rawRow);
    const now = new Date();

    const externalId = cleanId(row.external_id || row.id || row.externalid);
    if (!externalId) {
      console.warn('⚠️ Пропуск строки без external_id:', rawRow);
      continue;
    }

    const rawJson = JSON.stringify(row);

    // images: берём из нескольких возможных колонок и нормализуем к массиву строк
    const imagesArr = toJsonArray(row.images || row.image_urls || row.imageurl || row.image);
    const imagesJson = JSON.stringify(imagesArr);
    const mediaJson = JSON.stringify(imagesArr.map((url) => ({ type: 'image', url })));
    const geoJson = JSON.stringify(compactObject({
      country: toText(row.location_country) || 'ES',
      city: toText(row.location_city),
      district: toText(row.location_district),
      neighborhood: toText(row.location_neighborhood),
      address: toText(row.location_address),
      lat: toText(row.location_lat ?? row.lat),
      lng: toText(row.location_lng ?? row.lng)
    }));
    const infraArr = toJsonArray(row.building_infrastructure ?? row.infrastructure ?? row.infra);
    const featuresJson = JSON.stringify(compactObject({
      furnished: toBool(row.furnished),
      buildingYear: toInt(row.building_year),
      buildingFloors: toInt(row.building_floors),
      buildingInfrastructure: infraArr,
      rooms: toInt(row.specs_rooms),
      bathrooms: toInt(row.specs_bathrooms),
      areaM2: toInt(row.specs_area_m2),
      floor: toInt(row.specs_floor),
      balcony: toBool(row.specs_balcony),
      terrace: toBool(row.specs_terrace),
      pricePerM2: toInt(row.price_per_m2)
    }));

    await pool.query(
      `
      INSERT INTO properties (
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
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23, $24, $25, $26,
        $27, $28, $29, $30, $31, $32, $33
      )
      ON CONFLICT (client_id, external_id) DO UPDATE SET
        operation = EXCLUDED.operation,
        property_type = EXCLUDED.property_type,
        price_period = EXCLUDED.price_period,
        furnished = EXCLUDED.furnished,
        price_amount = EXCLUDED.price_amount,
        price_currency = EXCLUDED.price_currency,
        price_per_m2 = EXCLUDED.price_per_m2,
        geo = EXCLUDED.geo,
        features = EXCLUDED.features,
        media = EXCLUDED.media,
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
        normalizeOperation(row.operation),
        toText(row.property_type),
        toText(row.price_period || row.rent_period || row.period),
        toBool(row.furnished),

        toInt(row.price_amount),
        toText(row.price_currency) || 'EUR',
        toInt(row.price_per_m2),
        geoJson,
        featuresJson,
        mediaJson,

        toText(row.location_country) || 'ES',
        toText(row.location_city),
        toText(row.location_district),
        toText(row.location_neighborhood),
        toText(row.location_address),

        toInt(row.building_year),
        toInt(row.building_floors),
        infraArr.length ? JSON.stringify(infraArr) : null,

        toInt(row.specs_rooms),
        toInt(row.specs_bathrooms),
        toInt(row.specs_area_m2),
        toInt(row.specs_floor),
        toBool(row.specs_balcony),
        toBool(row.specs_terrace),

        toText(row.title),
        fixMojibake(toText(row.description)),
        imagesJson,
        rawJson,
        true,
        now,
        now
      ]
    );

    insertedOrUpdated++;
  }

  console.log(`✅ Импорт XLSX завершён. Обработано: ${insertedOrUpdated} строк для client_id="${CLIENT_ID}".`);
}

(async () => {
  try {
    await importXlsx();
  } catch (err) {
    console.error('❌ Ошибка импорта XLSX:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
