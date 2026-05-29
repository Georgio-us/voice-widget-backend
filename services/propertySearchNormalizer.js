const normalizeText = (value) => String(value || '').trim().toLowerCase();
const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';

const toQueryArray = (value) => {
  if (value == null) return [];
  const rawItems = Array.isArray(value) ? value : [value];
  return rawItems
    .flatMap((item) => String(item ?? '').split(','))
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
};

const normalizeOperationValue = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/(buy|sale|sell|purchase|покуп|купить|продаж)/i.test(raw)) return 'sale';
  if (/(rent|lease|аренд|оренд|снять)/i.test(raw)) return 'rent';
  return raw;
};

const DISTRICT_ALIASES = new Map([
  ['primorsky', 'приморский'],
  ['primorskiy', 'приморский'],
  ['primorski', 'приморский'],
  ['приморский', 'приморский'],
  ['проморский', 'приморский'],
  ['kievsky', 'киевский'],
  ['kyivskyi', 'киевский'],
  ['киевский', 'киевский'],
  ['suvorovsky', 'суворовский'],
  ['suvorovskiy', 'суворовский'],
  ['суворовский', 'суворовский'],
  ['котовского', 'суворовский'],
  ['поселок котовского', 'суворовский'],
  ['селище котовського', 'суворовский'],
  ['kotovskogo', 'суворовский'],
  ['kotovskoho', 'суворовский'],
  ['malinovsky', 'малиновский'],
  ['malinovskiy', 'малиновский'],
  ['малиновский', 'малиновский'],
  ['лиманка', 'киевский'],
  ['limanka', 'киевский'],
  ['крыжановка', 'суворовский'],
  ['кріжанівка', 'суворовский'],
  ['kryzhanivka', 'суворовский'],
  ['kryzhanovka', 'суворовский'],
  ['авангард', 'малиновский'],
  ['avangard', 'малиновский'],
  ['tairovo', 'киевский'],
  ['таирово', 'киевский']
]);

const normalizeDistrictValue = (value) => {
  const key = normalizeText(value);
  return DISTRICT_ALIASES.get(key) || key;
};

const hasToken = (value, token) => normalizeText(value).includes(normalizeText(token));
const isTrue = (value) => value === true || value === 'true' || value === 1 || value === '1';

const normalizeNeighborhoodValue = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/(аркад|arcad|аркаді)/i.test(raw)) return 'arcadia';
  if (/(центр|center|central)/i.test(raw)) return 'center';
  if (/(молдаван|moldav)/i.test(raw)) return 'moldavanka';
  if (/(черемуш|cheremush)/i.test(raw)) return 'cheremushky';
  if (/(слобод|slobid|slobod)/i.test(raw)) return 'slobidka';
  if (/(таир|tairo)/i.test(raw)) return 'tairovo';
  if (/(котовск|котовськ|kotov)/i.test(raw)) return 'kotovskoho';
  return raw;
};

const getFeatureComplex = (property) => {
  const direct = property?.features?.complex;
  const fromDisplay = property?.features?.display_specs?.complex;
  const raw = String(direct || fromDisplay || '').trim();
  if (!raw) return '';
  const tokens = raw.split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(tokens)].join(', ');
};

const getTotalFloors = (property = {}) => {
  const toIntSafe = (v) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) ? n : null;
  };
  return (
    toIntSafe(property?.total_floors)
    ?? toIntSafe(property?.floors_total)
    ?? toIntSafe(property?.building_floors)
    ?? toIntSafe(property?.features?.display_specs?.total_floors)
    ?? toIntSafe(property?.features?.total_floors)
    ?? toIntSafe(property?.features?.buildingFloors)
    ?? null
  );
};

const hasGovernmentProgram = (property, program = '') => {
  const features = property?.features && typeof property.features === 'object' ? property.features : {};
  const programList = Array.isArray(features.governmentPrograms)
    ? features.governmentPrograms.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const programToken = normalizeText(program);
  if (programToken) {
    return isTrue(features[programToken]) || programList.includes(programToken);
  }
  return (
    isTrue(features.governmentProgram)
    || isTrue(features.eoselia)
    || isTrue(features.evidnovlennia)
    || programList.length > 0
  );
};

const compareStrictSearchCards = (a, b) => {
  const pa = Number(a.priceEUR);
  const pb = Number(b.priceEUR);
  const paSafe = Number.isFinite(pa) ? pa : Number.MAX_SAFE_INTEGER;
  const pbSafe = Number.isFinite(pb) ? pb : Number.MAX_SAFE_INTEGER;
  if (paSafe !== pbSafe) return paSafe - pbSafe;

  const aa = Number(a.area_m2);
  const ab = Number(b.area_m2);
  const aaSafe = Number.isFinite(aa) ? aa : Number.MAX_SAFE_INTEGER;
  const abSafe = Number.isFinite(ab) ? ab : Number.MAX_SAFE_INTEGER;
  if (aaSafe !== abSafe) return aaSafe - abSafe;

  return String(a.id || '').localeCompare(String(b.id || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
};

const compareBrowseCards = (a, b) => {
  const ta = Date.parse(String(a.created_at || ''));
  const tb = Date.parse(String(b.created_at || ''));
  const taSafe = Number.isFinite(ta) ? ta : -Infinity;
  const tbSafe = Number.isFinite(tb) ? tb : -Infinity;
  if (taSafe !== tbSafe) return tbSafe - taSafe;

  const ida = Number(a.db_id);
  const idb = Number(b.db_id);
  const idaSafe = Number.isFinite(ida) ? ida : -Infinity;
  const idbSafe = Number.isFinite(idb) ? idb : -Infinity;
  if (idaSafe !== idbSafe) return idbSafe - idaSafe;

  return String(b.id || '').localeCompare(String(a.id || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
};

const normalizeProperty = (p) => {
  const toText = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'null') return null;
    return s;
  };

  const toInt = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'null') return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const toNumber = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'null') return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const toBool = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim().toLowerCase();
    if (!s || s === 'null') return null;
    return s === 'true' || s === '1' || s === 'yes' || s === 'y';
  };

  const toJsonObject = (v) => {
    if (!v) return null;
    if (typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v !== 'string') return null;
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const toJsonArray = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v !== 'string') return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const geo = toJsonObject(p.geo) || {};
  const feat = toJsonObject(p.features) || {};
  const media = toJsonArray(p.media);

  let images = [];
  try {
    if (Array.isArray(p.images)) {
      images = p.images;
    } else if (typeof p.images === 'string') {
      const parsed = JSON.parse(p.images);
      images = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    images = [];
  }

  images = (Array.isArray(images) ? images : [])
    .map((x) => toText(x))
    .filter(Boolean);
  if (!images.length && media.length) {
    images = media
      .map((m) => (m && typeof m === 'object' ? toText(m.url) : null))
      .filter(Boolean);
  }

  const idRaw = p.external_id ?? p.id ?? null;
  const id = (() => {
    const s = toText(idRaw);
    return s ? s.toUpperCase() : null;
  })();

  const city = toText(p.location?.city ?? geo.city ?? p.location_city);
  const district = toText(p.location?.district ?? geo.district ?? p.location_district);
  const neighborhood = toText(p.location?.neighborhood ?? geo.neighborhood ?? p.location_neighborhood);
  const address = toText(p.location?.address ?? geo.address ?? p.location_address);

  const rooms = toInt(p.specs?.rooms ?? feat.rooms ?? p.specs_rooms);
  const bathrooms = toInt(p.specs?.bathrooms ?? feat.bathrooms ?? p.specs_bathrooms);
  const area_m2 = toNumber(p.specs?.area_m2 ?? feat.areaM2 ?? p.specs_area_m2);
  const land_area_sotka = toNumber(
    p.specs?.land_area_sotka
    ?? feat.landAreaSotka
    ?? feat.land_area_sotka
    ?? feat?.display_specs?.land_area_sotka
  );
  const floor = toInt(p.specs?.floor ?? feat.floor ?? p.specs_floor);
  const building_floors = toInt(
    p.building_floors
    ?? p.floors_total
    ?? p.total_floors
    ?? feat?.display_specs?.total_floors
    ?? feat?.total_floors
    ?? feat?.buildingFloors
  );
  const balcony = toBool(p.specs?.balcony ?? feat.balcony ?? p.specs_balcony);
  const terrace = toBool(p.specs?.terrace ?? feat.terrace ?? p.specs_terrace);

  const priceUSD = toInt(
    p.price?.amount ??
    p.price_amount ??
    p.priceEUR
  );
  const price_per_m2 = toInt(p.price_per_m2);

  const operation = normalizeOperationValue(toText(p.operation));
  const property_type = toText(p.property_type);
  const furnished = toBool(p.furnished);

  const title = toText(p.title);
  const description = toText(p.description);

  return {
    id,
    db_id: toInt(p.id),
    created_at: p.created_at || null,
    operation,
    property_type,
    price_period: toText(p.price_period),
    furnished,
    city,
    district,
    neighborhood,
    address,
    rooms,
    bathrooms,
    area_m2,
    land_area_sotka,
    landAreaSotka: land_area_sotka,
    floor,
    building_floors,
    floors_total: building_floors,
    total_floors: building_floors,
    balcony,
    terrace,
    priceUSD,
    priceEUR: priceUSD,
    price_amount: priceUSD,
    price_usd: priceUSD,
    price_per_m2,
    title,
    description,
    images,
    features: {
      ...feat,
      smartFlat: feat.smartFlat === true,
      complex: (() => {
        const c = toText(feat.complex);
        if (!c) return null;
        return [...new Set(c.split(',').map(s => s.trim()).filter(Boolean))].join(', ');
      })(),
      display_specs: toJsonObject(feat.display_specs) || null
    }
  };
};

export {
  compareBrowseCards,
  compareStrictSearchCards,
  getFeatureComplex,
  getTotalFloors,
  hasGovernmentProgram,
  hasToken,
  hasValue,
  isTrue,
  normalizeDistrictValue,
  normalizeNeighborhoodValue,
  normalizeOperationValue,
  normalizeProperty,
  normalizeText,
  toQueryArray
};
