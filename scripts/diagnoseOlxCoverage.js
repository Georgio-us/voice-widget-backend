import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const LIMIT = 50;

const ROOM_CODE_CANDIDATES = [
  'number_of_rooms',
  'rooms',
  'bedrooms',
  'rooms_number',
  'room_count',
  'number_of_rooms_string',
  'rooms_number_string',
  'rooms_label',
  'layout'
];

const AREA_CODE_CANDIDATES = [
  'total_area',
  'area',
  'area_m2',
  'm2',
  'living_area',
  'house_area',
  'property_area',
  'building_area'
];

const FLOOR_CODE_CANDIDATES = [
  'floor',
  'floor_number',
  'floor_no',
  'floor_num',
  'storey'
];

const normalize = (v) => String(v || '').trim();

const inferSegment = (advert = {}) => {
  const attrs = Array.isArray(advert.attributes) ? advert.attributes : [];
  const codeSet = new Set(attrs.map((a) => normalize(a?.code).toLowerCase()).filter(Boolean));
  const titleDesc = `${normalize(advert.title)} ${normalize(advert.description)}`.toLowerCase();

  if (codeSet.has('property_type_houses') || codeSet.has('land_area')) return 'houses';
  if (/коммерц|commercial|office|shop|склад|нежил|магазин/.test(titleDesc)) return 'commercial';
  return 'apartments';
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

const getAdvert = (rawObj) => {
  if (!rawObj || typeof rawObj !== 'object') return null;
  return rawObj.advert && typeof rawObj.advert === 'object' ? rawObj.advert : rawObj;
};

const getAttributes = (advert) => (Array.isArray(advert?.attributes) ? advert.attributes : []);

const findCoverage = (attrs, candidates = []) => {
  const byCode = new Map();
  attrs.forEach((a) => {
    const code = normalize(a?.code).toLowerCase();
    if (!code) return;
    byCode.set(code, a);
  });
  for (const c of candidates) {
    const entry = byCode.get(c);
    if (!entry) continue;
    const value = entry?.value != null ? entry.value : Array.isArray(entry?.values) ? entry.values[0] : null;
    return { code: c, value: value ?? null };
  }
  return null;
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is missing. Run with DATABASE_URL=... node scripts/diagnoseOlxCoverage.js');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 2 });

  try {
    const { rows } = await pool.query(
      `
      SELECT external_id, title, category_id, raw, created_at, updated_at
      FROM properties
      WHERE external_id ILIKE 'OLX_%'
      ORDER BY COALESCE(updated_at, created_at, 'epoch'::timestamptz) DESC, id DESC
      LIMIT $1
      `,
      [LIMIT]
    );

    const codeStatsAll = new Map();
    const codeStatsBySegment = new Map([
      ['apartments', new Map()],
      ['houses', new Map()],
      ['commercial', new Map()]
    ]);

    const coverageRows = [];

    for (const row of rows) {
      const parsed = parseRaw(row.raw);
      const advert = getAdvert(parsed);
      if (!advert) continue;

      const attrs = getAttributes(advert);
      const segment = inferSegment(advert);
      const segmentMap = codeStatsBySegment.get(segment) || codeStatsBySegment.get('apartments');

      for (const attr of attrs) {
        const code = normalize(attr?.code).toLowerCase();
        if (!code) continue;

        codeStatsAll.set(code, (codeStatsAll.get(code) || 0) + 1);
        segmentMap.set(code, (segmentMap.get(code) || 0) + 1);
      }

      coverageRows.push({
        external_id: row.external_id,
        category_id: advert?.category_id ?? row.category_id ?? null,
        segment,
        room_hit: findCoverage(attrs, ROOM_CODE_CANDIDATES),
        area_hit: findCoverage(attrs, AREA_CODE_CANDIDATES),
        floor_hit: findCoverage(attrs, FLOOR_CODE_CANDIDATES)
      });
    }

    const sortMap = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`\n=== OLX diagnostics (last ${LIMIT}) ===`);
    console.log(`rows: ${rows.length}`);

    console.log('\n=== Unique codes (all segments) ===');
    for (const [code, count] of sortMap(codeStatsAll)) {
      console.log(`${code}\t${count}`);
    }

    for (const segment of ['apartments', 'houses', 'commercial']) {
      console.log(`\n=== Unique codes (${segment}) ===`);
      const m = codeStatsBySegment.get(segment) || new Map();
      for (const [code, count] of sortMap(m)) {
        console.log(`${code}\t${count}`);
      }
    }

    console.log('\n=== Coverage by advert (rooms/area/floor) ===');
    coverageRows.forEach((r) => {
      const room = r.room_hit ? `${r.room_hit.code}=${JSON.stringify(r.room_hit.value)}` : 'MISSING';
      const area = r.area_hit ? `${r.area_hit.code}=${JSON.stringify(r.area_hit.value)}` : 'MISSING';
      const floor = r.floor_hit ? `${r.floor_hit.code}=${JSON.stringify(r.floor_hit.value)}` : 'MISSING';
      console.log(`${r.external_id}\tseg=${r.segment}\tcat=${r.category_id ?? '-'}\trooms:${room}\tarea:${area}\tfloor:${floor}`);
    });

    const missing = coverageRows.filter((r) => !r.room_hit || !r.area_hit || !r.floor_hit);
    console.log(`\nMissing any of [rooms, area, floor]: ${missing.length}/${coverageRows.length}`);

    if (missing.length) {
      console.log('\n=== First 20 missing cases ===');
      missing.slice(0, 20).forEach((r) => {
        console.log(`${r.external_id}\tseg=${r.segment}\tcat=${r.category_id ?? '-'}`);
      });
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
