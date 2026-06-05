import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../services/db.js';

const DEFAULT_FEED_URL = 'https://estylespain.com/xml/xml-mediaelx.php?f=69e7b52b6c411';
const FEED_URL = process.argv[2] || process.env.XML_FEED_URL || DEFAULT_FEED_URL;
const CLIENT_ID = process.env.IMPORT_CLIENT_ID || process.env.APP_CLIENT_ID || 'demo';
const DRY_RUN = ['1', 'true', 'yes'].includes(String(process.env.XML_IMPORT_DRY_RUN || '').trim().toLowerCase());
const SYNC_DEACTIVATE = ['1', 'true', 'yes'].includes(String(process.env.XML_SYNC_DEACTIVATE || '').trim().toLowerCase());
const SYNC_MIN_COUNT = (() => {
  const n = Number.parseInt(String(process.env.XML_SYNC_MIN_COUNT || '500'), 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
})();
const LIMIT = (() => {
  const v = process.env.XML_IMPORT_LIMIT || '';
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const PG_INT4_MIN = -2147483648;
const PG_INT4_MAX = 2147483647;

const toText = (v) => {
  if (v === undefined || v === null) return null;
  let s = String(v).trim();
  s = s.replace(/^<!\[CDATA\[(.*)\]\]>$/is, '$1').trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s;
};

const toInt = (v) => {
  const s = toText(v);
  if (!s) return null;
  const cleaned = s.replace(/[^\d-]/g, '');
  if (!cleaned) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
};

const toInt4 = (v) => {
  const n = toInt(v);
  if (n === null) return null;
  if (n < PG_INT4_MIN || n > PG_INT4_MAX) return null;
  return n;
};

const toNumber = (v) => {
  const s = toText(v);
  if (!s) return null;
  const cleaned = s.replace(/,/g, '.').replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractTag = (xml, tag) => {
  const re = new RegExp(`<${escapeRegExp(tag)}[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
};

const extractTags = (xml, tag) => {
  const re = new RegExp(`<${escapeRegExp(tag)}[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'gi');
  const out = [];
  let m = re.exec(xml);
  while (m) {
    out.push(m[1]);
    m = re.exec(xml);
  }
  return out;
};

const pickLang = (nodeXml, orderedLangs) => {
  if (!nodeXml) return null;
  for (const lang of orderedLangs) {
    const value = toText(extractTag(nodeXml, lang));
    if (value) return value;
  }
  return null;
};

const pickAnyLang = (nodeXml) => {
  return pickLang(nodeXml, ['en', 'es', 'ru', 'no', 'de', 'fr', 'it', 'nl', 'da', 'fi', 'is', 'se', 'zh', 'pl', 'ca']);
};

const normalizeTagLabel = (v) => {
  const s = toText(v);
  if (!s) return null;
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
};

const extractTagLabels = (propertyXml) => {
  const tagsNode = extractTag(propertyXml, 'tags');
  if (!tagsNode) return [];
  const tagNodes = extractTags(tagsNode, 'tag');
  const labels = tagNodes
    .map((tagNode) => pickLang(tagNode, ['en', 'es', 'ru']) || pickAnyLang(tagNode) || normalizeTagLabel(tagNode))
    .map(normalizeTagLabel)
    .filter(Boolean);
  return Array.from(new Set(labels));
};

const extractTagLabelsI18n = (propertyXml, langs = ['ru', 'en', 'es']) => {
  const tagsNode = extractTag(propertyXml, 'tags');
  const out = Object.fromEntries(langs.map((lang) => [lang, []]));
  if (!tagsNode) return out;
  const tagNodes = extractTags(tagsNode, 'tag');
  for (const tagNode of tagNodes) {
    for (const lang of langs) {
      const value = normalizeTagLabel(extractTag(tagNode, lang));
      if (value) out[lang].push(value);
    }
  }
  for (const lang of langs) {
    out[lang] = Array.from(new Set(out[lang]));
  }
  return out;
};

const extractLocalizedText = (propertyXml, tagName) => {
  const node = extractTag(propertyXml, tagName);
  if (!node) return null;
  return pickLang(node, ['en', 'es', 'ru']) || pickAnyLang(node) || toText(node);
};

const extractLangMap = (nodeXml, langs = ['ru', 'en', 'es']) => {
  const out = {};
  if (!nodeXml) return out;
  for (const lang of langs) {
    const value = toText(extractTag(nodeXml, lang));
    if (value) out[lang] = value;
  }
  return out;
};

const extractDistanceMed = (propertyXml, baseTag) => {
  const direct = toText(extractTag(propertyXml, `${baseTag}_med`));
  if (direct) return direct;
  const node = extractTag(propertyXml, baseTag);
  if (!node) return null;
  return toText(extractTag(node, 'med')) || toText(extractTag(node, 'unit')) || null;
};

const normalizeOperation = (priceFreqRaw) => {
  const f = String(priceFreqRaw || '').trim().toLowerCase();
  if (f === 'week') return 'rent';
  if (f === 'sale') return 'sale';
  if (f === 'month' || f === 'monthly' || f === 'rent') return 'rent';
  return 'sale';
};

const propertyTypeFromTypeNode = (typeNodeXml) => {
  const raw = pickLang(typeNodeXml, ['en', 'es', 'ru', 'no']) || 'property';
  return raw.trim().toLowerCase();
};

const extractImages = (propertyXml) => {
  const imagesNode = extractTag(propertyXml, 'images');
  if (!imagesNode) return [];
  const imageNodes = extractTags(imagesNode, 'image');
  const urls = imageNodes
    .map((imgNode) => toText(extractTag(imgNode, 'url')))
    .filter(Boolean);
  return Array.from(new Set(urls));
};

const buildExternalId = (propertyXml) => {
  const ref = toText(extractTag(propertyXml, 'ref'));
  const id = toText(extractTag(propertyXml, 'id'));
  const value = ref || id;
  return value ? value.toUpperCase() : null;
};

async function ensureUniqueIndex(db = pool) {
  await db.query(`
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

async function upsertProperty(record, db = pool) {
  const now = new Date();
  await db.query(
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
      specs_plot_m2,
      specs_floor,
      has_parking,
      has_pool,
      is_new_build,
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
      $17, $18, $19, $20, $21, $22, $23, $24,
      $25, $26, $27, $28, $29, $30, $31, $32, $33
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
      specs_plot_m2 = EXCLUDED.specs_plot_m2,
      specs_floor = EXCLUDED.specs_floor,
      has_parking = EXCLUDED.has_parking,
      has_pool = EXCLUDED.has_pool,
      is_new_build = EXCLUDED.is_new_build,
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
      record.externalId,
      record.operation,
      record.propertyType,
      null,

      record.priceAmount,
      record.priceCurrency || 'EUR',
      null,

      'ES',
      record.city,
      record.province,
      record.locationDetail,
      record.address,

      record.yearBuild,
      null,
      null,

      record.beds,
      record.baths,
      record.areaBuilt,
      record.areaPlot,
      record.floor,
      record.hasParking,
      record.hasPool,
      record.isNewBuild,
      null,
      null,

      record.title,
      record.description,
      JSON.stringify(record.images || []),
      JSON.stringify(record.raw),
      true,
      now,
      now
    ]
  );
}

function buildRecord(block) {
  const externalId = buildExternalId(block);
  if (!externalId) return null;

  const typeNode = extractTag(block, 'type');
  const titleNode = extractTag(block, 'title');
  const descNode = extractTag(block, 'desc');
  const surfaceNode = extractTag(block, 'surface_area');
  const urlNode = extractTag(block, 'url');
  const tags = extractTagLabels(block);
  const tagsI18n = extractTagLabelsI18n(block, ['ru', 'en', 'es']);

  const priceFreqRaw = toText(extractTag(block, 'price_freq'));
  const operation = normalizeOperation(priceFreqRaw);

  return {
    externalId,
    operation,
    propertyType: propertyTypeFromTypeNode(typeNode),
    city: toText(extractTag(block, 'town')),
    province: toText(extractTag(block, 'province')),
    locationDetail: toText(extractTag(block, 'location_detail')),
    address: toText(extractTag(extractTag(block, 'location') || '', 'address')),
    beds: toInt4(extractTag(block, 'beds')),
    baths: toInt4(extractTag(block, 'baths')),
    areaBuilt: toInt4(extractTag(surfaceNode || '', 'built')),
    areaPlot: toInt4(extractTag(surfaceNode || '', 'plot')),
    areaTerrace: toInt4(extractTag(surfaceNode || '', 'terrace')),
    floor: toInt4(extractTag(block, 'floor')),
    hasParking: Boolean(toText(pickAnyLang(extractTag(block, 'parking')))),
    hasPool: Boolean(toText(pickAnyLang(extractTag(block, 'pool')))),
    isNewBuild: Boolean(toText(extractTag(block, 'new_build'))),
    priceAmount: toInt4(extractTag(block, 'price')),
    priceCurrency: toText(extractTag(block, 'currency')) || 'EUR',
    title: pickLang(titleNode, ['ru', 'en', 'es']),
    description: pickLang(descNode, ['ru', 'en', 'es']),
    yearBuild: toInt4(extractTag(block, 'year_build')),
    images: extractImages(block),
    tags,
    raw: {
      source: 'xml-mediaelx',
      feedUrl: FEED_URL,
      importedAt: new Date().toISOString(),
      id: toText(extractTag(block, 'id')),
      ref: toText(extractTag(block, 'ref')),
      priceFreq: priceFreqRaw,
      descriptionI18n: extractLangMap(descNode, ['ru', 'en', 'es']),
      yearBuild: toInt4(extractTag(block, 'year_build')),
      terrace: toInt4(extractTag(surfaceNode || '', 'terrace')),
      orientation: extractLocalizedText(block, 'orientation'),
      distanceBeach: toNumber(extractTag(block, 'distance_beach')),
      distanceBeachMed: extractDistanceMed(block, 'distance_beach'),
      distanceAirport: toNumber(extractTag(block, 'distance_airport')),
      distanceAirportMed: extractDistanceMed(block, 'distance_airport'),
      distanceGolf: toNumber(extractTag(block, 'distance_golf')),
      distanceGolfMed: extractDistanceMed(block, 'distance_golf'),
      distanceAmenities: toNumber(extractTag(block, 'distance_amenities')),
      distanceAmenitiesMed: extractDistanceMed(block, 'distance_amenities'),
      tagsI18n,
      tags,
      url: pickLang(urlNode, ['en', 'es', 'ru'])
    }
  };
}

async function getSyncPreview(records) {
  if (!process.env.DATABASE_URL) return null;
  const feedIds = records.map((record) => record.externalId);
  const { rows } = await pool.query(
    `
    SELECT external_id, is_active
    FROM properties
    WHERE client_id = $1
    `,
    [CLIENT_ID]
  );
  const feedSet = new Set(feedIds);
  const dbSet = new Set(rows.map((row) => String(row.external_id || '').trim().toUpperCase()).filter(Boolean));
  const activeRows = rows.filter((row) => row.is_active === true);
  const activeMissing = activeRows
    .map((row) => String(row.external_id || '').trim().toUpperCase())
    .filter((id) => id && !feedSet.has(id));
  const newInFeed = feedIds.filter((id) => !dbSet.has(id));
  return {
    dbTotalForClient: rows.length,
    dbActiveForClient: activeRows.length,
    newInFeedCount: newInFeed.length,
    wouldDeactivateCount: activeMissing.length,
    newInFeedSample: newInFeed.slice(0, 20),
    wouldDeactivateSample: activeMissing.slice(0, 20)
  };
}

async function run() {
  console.log('🚀 XML import started');
  console.log('ℹ️ feed_url =', FEED_URL);
  console.log('ℹ️ client_id =', CLIENT_ID);
  console.log('ℹ️ dry_run =', DRY_RUN ? 'yes' : 'no');
  console.log('ℹ️ sync_deactivate =', SYNC_DEACTIVATE ? 'yes' : 'no');
  console.log('ℹ️ sync_min_count =', SYNC_MIN_COUNT);
  if (LIMIT) console.log('ℹ️ limit =', LIMIT);

  const response = await fetch(FEED_URL);
  if (!response.ok) {
    throw new Error(`Feed request failed: HTTP ${response.status}`);
  }
  const xml = await response.text();

  const propertyBlocks = extractTags(xml, 'property');
  const total = LIMIT ? Math.min(LIMIT, propertyBlocks.length) : propertyBlocks.length;
  console.log(`ℹ️ found properties = ${propertyBlocks.length}`);
  console.log(`ℹ️ processing = ${total}`);

  let skipped = 0;
  const records = [];

  for (const block of propertyBlocks.slice(0, total)) {
    const record = buildRecord(block);
    if (!record) {
      skipped += 1;
      continue;
    }
    records.push(record);
  }

  const operationStats = records.reduce((acc, record) => {
    if (record.operation === 'rent') acc.rent += 1;
    else acc.sale += 1;
    return acc;
  }, { sale: 0, rent: 0 });
  const uniqueExternalIds = new Set(records.map((record) => record.externalId));

  if (uniqueExternalIds.size !== records.length) {
    throw new Error(`Duplicate external_id values in feed: records=${records.length}, unique=${uniqueExternalIds.size}`);
  }

  if (records.length < SYNC_MIN_COUNT) {
    throw new Error(`Feed sanity check failed: parsed ${records.length}, minimum is ${SYNC_MIN_COUNT}`);
  }

  if (SYNC_DEACTIVATE && LIMIT) {
    throw new Error('Refusing XML_SYNC_DEACTIVATE with XML_IMPORT_LIMIT; full feed is required for safe deactivation');
  }

  const preview = await getSyncPreview(records).catch((err) => ({
    error: `preview_failed: ${err.message}`
  }));

  if (DRY_RUN) {
    console.log('✅ XML import dry-run completed');
    console.log(
      JSON.stringify(
        {
          clientId: CLIENT_ID,
          feedUrl: FEED_URL,
          found: propertyBlocks.length,
          parsed: records.length,
          skipped,
          operationStats,
          syncDeactivate: SYNC_DEACTIVATE,
          preview
        },
        null,
        2
      )
    );
    return;
  }

  await ensureUniqueIndex();

  const client = await pool.connect();
  let deactivated = 0;
  try {
    await client.query('BEGIN');
    for (const record of records) {
      await upsertProperty(record, client);
    }
    if (SYNC_DEACTIVATE) {
      const ids = records.map((record) => record.externalId);
      const result = await client.query(
        `
        UPDATE properties
        SET is_active = false, updated_at = NOW()
        WHERE client_id = $1
          AND is_active = true
          AND NOT (external_id = ANY($2::text[]))
        `,
        [CLIENT_ID, ids]
      );
      deactivated = result.rowCount || 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log('✅ XML import completed');
  console.log(
    JSON.stringify(
      {
        clientId: CLIENT_ID,
        feedUrl: FEED_URL,
        found: propertyBlocks.length,
        processed: records.length,
        skipped,
        operationStats,
        syncDeactivate: SYNC_DEACTIVATE,
        deactivated,
        preview
      },
      null,
      2
    )
  );
}

run()
  .catch((err) => {
    console.error('❌ XML import failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
