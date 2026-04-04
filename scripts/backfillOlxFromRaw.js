import 'dotenv/config';
import { pool } from '../services/db.js';
import { normalizeOlxAdvert } from '../services/olxImportService.js';

const BATCH_SIZE = Number(process.env.OLX_BACKFILL_BATCH_SIZE || 200);
const DRY_RUN = String(process.env.OLX_BACKFILL_DRY_RUN || '').toLowerCase() === 'true';
const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const parseRaw = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
};

async function updatePropertyFromMapped(id, mapped) {
  await pool.query(
    `
    UPDATE properties
    SET
      operation = $2,
      property_type = $3,
      price_amount = $4,
      price_currency = $5,
      geo = $6::jsonb,
      features = $7::jsonb,
      media = $8::jsonb,
      location_city = $9,
      location_district = $10,
      location_neighborhood = $11,
      location_address = $12,
      building_floors = $13,
      specs_rooms = $14,
      specs_area_m2 = $15,
      specs_floor = $16,
      specs_balcony = $17,
      title = $18,
      description = $19,
      images = $20::jsonb,
      raw = $21::jsonb,
      is_active = $22,
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      id,
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
      toNumberOrNull(mapped.areaM2),
      mapped.floor,
      mapped.hasBalcony,
      mapped.title,
      mapped.description,
      JSON.stringify(mapped.images || []),
      JSON.stringify(mapped.raw || {}),
      mapped.isActive
    ]
  );
}

async function processBatch(offset) {
  const { rows } = await pool.query(
    `
    SELECT id, client_id, external_id, raw
    FROM properties
    WHERE external_id ILIKE 'OLX_%'
    ORDER BY id ASC
    LIMIT $1 OFFSET $2
    `,
    [BATCH_SIZE, offset]
  );
  return rows;
}

async function main() {
  const { rows: totalRows } = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM properties
    WHERE external_id ILIKE 'OLX_%'
    `
  );
  const total = totalRows?.[0]?.total || 0;
  if (!total) {
    console.log('No OLX records found.');
    return;
  }

  let offset = 0;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`OLX backfill started. total=${total}, batch=${BATCH_SIZE}, dryRun=${DRY_RUN}`);

  while (offset < total) {
    const batch = await processBatch(offset);
    if (!batch.length) break;

    for (const row of batch) {
      processed += 1;
      try {
        const parsedRaw = parseRaw(row.raw);
        const advert = parsedRaw?.advert && typeof parsedRaw.advert === 'object' ? parsedRaw.advert : null;
        if (!advert) {
          skipped += 1;
          continue;
        }

        const mapped = normalizeOlxAdvert(advert, row.client_id);
        if (!mapped?.externalId) {
          skipped += 1;
          continue;
        }

        if (!DRY_RUN) {
          await updatePropertyFromMapped(row.id, mapped);
        }
        updated += 1;
      } catch (error) {
        failed += 1;
        console.error(`Backfill failed for id=${row.id}, external_id=${row.external_id}:`, error?.message || error);
      }
    }

    console.log(`Progress: ${processed}/${total} (updated=${updated}, skipped=${skipped}, failed=${failed})`);
    offset += batch.length;
  }

  console.log('OLX backfill finished.');
  console.log(JSON.stringify({ total, processed, updated, skipped, failed, dryRun: DRY_RUN }, null, 2));
}

main()
  .catch((error) => {
    console.error('OLX backfill crashed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
