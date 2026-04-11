const BASE = String(process.env.VW_TEST_BASE_URL || 'https://voice-widget-backend-tgdubai-split.up.railway.app/api/cards/search').trim();
const LIMIT = String(process.env.VW_TEST_LIMIT || '200').trim();

const normalizeText = (v) => String(v || '').trim().toLowerCase();
const normalizeDistrict = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/примор|primor|promor/.test(raw)) return 'primorsky';
  if (/киев|kiev|kyiv|таир|tairo|лиман|liman/.test(raw)) return 'kievsky';
  if (/сувор|suvor|котов/.test(raw)) return 'suvorovsky';
  if (/малин|malin|аванг/.test(raw)) return 'malinovsky';
  return raw;
};
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isTrue = (v) => {
  if (v === true || v === 1) return true;
  const s = normalizeText(v);
  return ['1', 'true', 'yes', 'y', 'да', 'так', 'є'].includes(s);
};
const getComplex = (c) => String(c?.features?.complex || c?.features?.display_specs?.complex || '').trim();
const getTotalFloors = (c) => {
  const candidates = [
    c?.total_floors, c?.floors_total, c?.building_floors,
    c?.features?.display_specs?.total_floors, c?.features?.total_floors, c?.features?.buildingFloors
  ];
  for (const x of candidates) {
    const n = parseInt(String(x ?? '').trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const cardMatches = (card, q) => {
  const issues = [];
  const op = normalizeText(card?.operation);
  const type = normalizeText(card?.property_type);
  const district = normalizeDistrict(card?.district);
  const rooms = toNum(card?.rooms);
  const price = toNum(card?.priceUSD ?? card?.priceEUR ?? card?.price_amount);
  const area = toNum(card?.area_m2);
  const floor = toNum(card?.floor);
  const totalFloors = getTotalFloors(card);
  const complex = getComplex(card);
  const neigh = normalizeText(card?.neighborhood);
  const title = normalizeText(card?.title);

  if (q.operation && op !== q.operation) issues.push(`operation=${op}`);
  if (q.type && type !== q.type) issues.push(`type=${type}`);
  if (q.district && district !== q.district) issues.push(`district=${district}`);
  if (q.rooms != null && rooms !== Number(q.rooms)) issues.push(`rooms=${rooms}`);
  if (q.minPrice != null && !(price != null && price >= Number(q.minPrice))) issues.push(`price=${price}`);
  if (q.maxPrice != null && !(price != null && price <= Number(q.maxPrice))) issues.push(`price=${price}`);
  if (q.minArea != null && !(area != null && area >= Number(q.minArea))) issues.push(`area=${area}`);
  if (q.maxArea != null && !(area != null && area <= Number(q.maxArea))) issues.push(`area=${area}`);
  if (q.minFloor != null && !(floor != null && floor >= Number(q.minFloor))) issues.push(`floor=${floor}`);
  if (q.maxFloor != null && !(floor != null && floor <= Number(q.maxFloor))) issues.push(`floor=${floor}`);
  if (q.rcOnly === 'true' && !complex) issues.push('rcOnly=false');
  if (q.parking === 'true' && !(isTrue(card?.features?.parking) || isTrue(card?.features?.has_parking))) issues.push('parking=false');
  if (q.balconyLoggia === 'true' && !(isTrue(card?.balcony) || isTrue(card?.features?.balcony) || isTrue(card?.features?.loggia))) issues.push('balconyLoggia=false');
  if (q.exclusive === 'true' && !isTrue(card?.features?.exclusive)) issues.push('exclusive=false');
  if (q.arcadia === 'true') {
    const ok = neigh.includes('аркад') || neigh.includes('arcad') || title.includes('аркад') || title.includes('arcad');
    if (!ok) issues.push('arcadia=false');
  }
  if (q.center === 'true') {
    const ok = neigh === 'центр' || neigh === 'center' || neigh.includes('центр');
    if (!ok) issues.push(`center=false(neigh=${neigh || '-'})`);
  }
  if (q.residentialComplex) {
    const needle = normalizeText(q.residentialComplex).replace(/^(жк|зк|жилой комплекс)\s*/, '').trim();
    const hay = normalizeText(complex);
    if (!hay.includes(needle)) issues.push(`residentialComplex=${complex || '-'}`);
  }
  if (q.floorNotLast === 'true') {
    if (floor == null) issues.push('floorNotLast:floor=?');
    else if (Number.isFinite(totalFloors) && totalFloors > 1 && !(floor < totalFloors)) {
      issues.push(`floorNotLast:${floor}/${totalFloors}`);
    }
  }
  return issues;
};

const stepUrl = (q) => {
  const u = new URL(BASE);
  for (const [k, v] of Object.entries(q)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    u.searchParams.set(k, s);
  }
  u.searchParams.set('limit', LIMIT);
  return u.toString();
};

async function runSeries(name, steps) {
  const results = [];
  let query = {};
  for (const st of steps) {
    query = { ...query, ...st.add };
    const url = stepUrl(query);
    const res = await fetch(url);
    const json = await res.json();
    const cards = Array.isArray(json.cards) ? json.cards : [];
    let violations = 0;
    const samples = [];
    for (const c of cards) {
      const issues = cardMatches(c, query);
      if (issues.length) {
        violations += 1;
        if (samples.length < 3) samples.push({ id: c.id, issues });
      }
    }
    results.push({ step: st.label, query: { ...query }, count: cards.length, violations, samples });
  }
  return { name, results };
}

const saleSteps = [
  { label: '+ Тип операции (Продажа)', add: { operation: 'sale' } },
  { label: '+ Тип недвижимости', add: { type: 'apartment' } },
  { label: '+ Район', add: { district: 'primorsky' } },
  { label: '+ Комнаты', add: { rooms: 2 } },
  { label: '+ Цена 25-200k', add: { minPrice: 25000, maxPrice: 200000 } },
  { label: '+ Метраж 20-200', add: { minArea: 20, maxArea: 200 } },
  { label: '+ Этаж 1-25', add: { minFloor: 1, maxFloor: 25 } },
  { label: '+ Только ЖК', add: { rcOnly: true } },
  { label: '+ Паркинг', add: { parking: true } },
  { label: '+ Лоджия', add: { balconyLoggia: true } },
  { label: '+ Эксклюзивы', add: { exclusive: true } },
  { label: '+ Аркадия', add: { arcadia: true } },
  { label: '+ Центр', add: { center: true } },
  { label: '+ Указать ЖК (Консул)', add: { residentialComplex: 'Консул' } }
];

const rentSteps = [
  { label: '+ Тип операции (Аренда)', add: { operation: 'rent' } },
  { label: '+ Тип недвижимости', add: { type: 'apartment' } },
  { label: '+ Район', add: { district: 'primorsky' } },
  { label: '+ Комнаты', add: { rooms: 2 } },
  { label: '+ Цена 200-2000', add: { minPrice: 200, maxPrice: 2000 } },
  { label: '+ Метраж 10-150', add: { minArea: 10, maxArea: 150 } },
  { label: '+ Этаж 5-20', add: { minFloor: 5, maxFloor: 20 } },
  { label: '+ Только ЖК', add: { rcOnly: true } },
  { label: '+ Паркинг', add: { parking: true } },
  { label: '+ Лоджия', add: { balconyLoggia: true } },
  { label: '+ Эксклюзивы', add: { exclusive: true } },
  { label: '+ Аркадия', add: { arcadia: true } },
  { label: '+ Центр', add: { center: true } },
  { label: '+ Указать ЖК (Апельсин)', add: { residentialComplex: 'Апельсин' } }
];

const summarize = (series) => {
  let total = 0;
  let failed = 0;
  console.log(`\n=== ${series.name} ===`);
  for (const row of series.results) {
    total += 1;
    const ok = row.violations === 0;
    if (!ok) failed += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${row.step} | cards=${row.count} | violations=${row.violations}`);
    if (!ok && row.samples.length) {
      row.samples.forEach((s) => console.log(`   - ${s.id}: ${s.issues.join(', ')}`));
    }
  }
  return { total, failed };
};

(async () => {
  console.log(`Base URL: ${BASE}`);
  console.log(`Limit: ${LIMIT}`);
  const sale = await runSeries('SALE sequence', saleSteps);
  const rent = await runSeries('RENT sequence', rentSteps);
  const a = summarize(sale);
  const b = summarize(rent);
  const total = a.total + b.total;
  const failed = a.failed + b.failed;
  const passed = total - failed;
  console.log('\n=== SUMMARY ===');
  console.log(`Total tests: ${total}`);
  console.log(`Failed: ${failed}`);
  console.log(`Passed: ${passed}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error('manualFiltersMatrixTest failed:', error?.message || error);
  process.exit(1);
});
