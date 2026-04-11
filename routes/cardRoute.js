import express from 'express';
import { 
  getAllProperties, 
  getPropertyByExternalId 
} from '../services/propertiesRepository.js';
import { listResidentialComplexes } from '../services/residentialComplexesRepository.js';
import { buildScoreContext as buildUnifiedScoreContext, annotatePropertyScoresByContext } from '../services/scoringEngine.js';

const router = express.Router();
const SERVICE_CLIENT_ID = String(process.env.CLIENT_ID || '').trim();

const normalizeText = (value) => String(value || '').trim().toLowerCase();
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
  // Greater Odesa localities mapped to base city districts
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
  return raw;
};
const getFeatureComplex = (property) => {
  const direct = property?.features?.complex;
  const fromDisplay = property?.features?.display_specs?.complex;
  return String(direct || fromDisplay || '').trim();
};

// scoring is centralized in services/scoringEngine.js

/**
 * Нормализация объекта из БД (Postgres)
 * + поддержка legacy-формата (если где-то ещё используется)
 * + приведение типов (int / boolean), чтобы UI и фильтры работали корректно
 * + trim/cleanup строк (убираем пробелы из XLSX типа "A102 ")
 */
const normalizeProperty = (p) => {

  // ---------- helpers ----------
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

  // ---------- images ----------
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
  // подчистим массив картинок
  images = (Array.isArray(images) ? images : [])
    .map((x) => toText(x))
    .filter(Boolean);
  if (!images.length && media.length) {
    images = media
      .map((m) => (m && typeof m === 'object' ? toText(m.url) : null))
      .filter(Boolean);
  }

  // ---------- id ----------
  // важно: trim + (опционально) upperCase, чтобы A102 " и A102 были одним и тем же
  const idRaw = p.external_id ?? p.id ?? null;
  const id = (() => {
    const s = toText(idRaw);
    return s ? s.toUpperCase() : null;
  })();

  // ---------- location ----------
  const city = toText(p.location?.city ?? geo.city ?? p.location_city);
  const district = toText(p.location?.district ?? geo.district ?? p.location_district);
  const neighborhood = toText(p.location?.neighborhood ?? geo.neighborhood ?? p.location_neighborhood);
  const address = toText(p.location?.address ?? geo.address ?? p.location_address);

  // ---------- specs ----------
  const rooms = toInt(p.specs?.rooms ?? feat.rooms ?? p.specs_rooms);
  const bathrooms = toInt(p.specs?.bathrooms ?? feat.bathrooms ?? p.specs_bathrooms);
  const area_m2 = toNumber(p.specs?.area_m2 ?? feat.areaM2 ?? p.specs_area_m2);
  const floor = toInt(p.specs?.floor ?? feat.floor ?? p.specs_floor);
  const balcony = toBool(p.specs?.balcony ?? feat.balcony ?? p.specs_balcony);
  const terrace = toBool(p.specs?.terrace ?? feat.terrace ?? p.specs_terrace);

  // ---------- price ----------
  const priceUSD = toInt(
    p.price?.amount ??
    p.price_amount ??
    p.priceEUR
  );

  const price_per_m2 = toInt(p.price_per_m2);

  // ---------- operation / property_type / furnished ----------
  // trim, чтобы убрать " sale " / " apartment " из XLSX
  const operation = normalizeOperationValue(toText(p.operation));
  const property_type = toText(p.property_type);
  const furnished = toBool(p.furnished);

  // ---------- texts ----------
  const title = toText(p.title);
  const description = toText(p.description);

  return {
    id,
    operation,
    property_type,
    price_period: toText(p.price_period),
    furnished,

    // location
    city,
    district,
    neighborhood,
    address,

    // specs
    rooms,
    bathrooms,
    area_m2,
    floor,
    balcony,
    terrace,

    // price
    // Canonical price key is USD. Keep legacy aliases for backward compatibility.
    priceUSD: priceUSD,
    priceEUR: priceUSD,
    price_amount: priceUSD,
    price_usd: priceUSD,
    price_per_m2,

    // texts
    title,
    description,

    // images
    images,

    // full normalized features payload (preserve existing keys + pass through group2 display specs)
    features: {
      ...feat,
      smartFlat: feat.smartFlat === true,
      complex: toText(feat.complex),
      display_specs: toJsonObject(feat.display_specs) || null
    }
  };
};

// ===============================
//            ROUTES
// ===============================

// Поиск по фильтрам
router.get('/search', async (req, res) => {
  try {
    const {
      city,
      district,
      rooms,
      type,
      operation,
      minPrice,
      maxPrice,
      minArea,
      maxArea,
      minFloor,
      maxFloor,
      smart,
      arcadia,
      rcOnly,
      residentialComplex,
      exclusive,
      center,
      parking,
      balconyLoggia,
      limit = 10
    } = req.query;

    const toInt = (v) => (v == null ? null : parseInt(String(v), 10));
    const toNumber = (v) => {
      if (v == null) return null;
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    const toBool = (v) => {
      const raw = normalizeText(v);
      return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
    };
    const min = toInt(minPrice);
    const max = toInt(maxPrice);
    const r = toInt(rooms);
    const areaMin = toNumber(minArea);
    const areaMax = toNumber(maxArea);
    const floorMin = toInt(minFloor);
    const floorMax = toInt(maxFloor);
    const onlySmart = toBool(smart);
    const onlyArcadia = toBool(arcadia);
    const onlyRc = toBool(rcOnly);
    const rcNeedle = normalizeText(residentialComplex);
    const onlyExclusive = toBool(exclusive);
    const onlyCenter = toBool(center);
    const onlyParking = toBool(parking);
    const onlyBalconyLoggia = toBool(balconyLoggia);

    // Берём все объекты клиента из CLIENT_ID env
    const rawList = await getAllProperties();
    let list = rawList.map(normalizeProperty);

    // ---------- filters ----------
    if (city) {
      const c = String(city).toLowerCase().trim();
      list = list.filter(p => p.city && p.city.toLowerCase() === c);
    }

    if (district) {
      const d = normalizeDistrictValue(district);
      list = list.filter((p) => normalizeDistrictValue(p.district) === d);
    }

    if (type) {
      const t = String(type).trim();
      list = list.filter(p => p.property_type === t);
    }

    if (operation) {
      const want = normalizeOperationValue(operation);
      list = list.filter((p) => normalizeOperationValue(p.operation) === want);
    }

    const roomsStr = String(rooms || '').trim();
    if (roomsStr === '5plus') {
      list = list.filter((p) => Number(p.rooms) >= 5);
    } else if (roomsStr === '4plus') {
      list = list.filter((p) => Number(p.rooms) >= 4);
    } else if (r != null) {
      list = list.filter((p) => Number(p.rooms) === r);
    }

    if (min != null) {
      list = list.filter(p => Number(p.priceEUR) >= min);
    }

    if (max != null) {
      list = list.filter(p => Number(p.priceEUR) <= max);
    }

    if (areaMin != null) {
      list = list.filter((p) => Number(p.area_m2) >= areaMin);
    }

    if (areaMax != null) {
      list = list.filter((p) => Number(p.area_m2) <= areaMax);
    }

    if (floorMin != null) {
      list = list.filter((p) => Number(p.floor) >= floorMin);
    }

    if (floorMax != null) {
      list = list.filter((p) => Number(p.floor) <= floorMax);
    }

    if (onlySmart) {
      list = list.filter((p) => p?.features?.smartFlat === true);
    }

    if (onlyArcadia) {
      list = list.filter((p) => {
        const neighborhoodNorm = normalizeNeighborhoodValue(p?.neighborhood);
        if (neighborhoodNorm === 'arcadia') return true;
        // Temporary fallback: title only (description excluded as too noisy).
        return hasToken(p?.title, 'аркад') || hasToken(p?.title, 'arcad');
      });
    }

    if (onlyExclusive) {
      list = list.filter((p) => isTrue(p?.features?.exclusive));
    }

    if (onlyCenter) {
      list = list.filter((p) => normalizeNeighborhoodValue(p?.neighborhood) === 'center');
    }

    if (onlyParking) {
      list = list.filter((p) => isTrue(p?.features?.parking));
    }

    if (onlyBalconyLoggia) {
      list = list.filter((p) => isTrue(p?.balcony) || isTrue(p?.features?.balcony) || isTrue(p?.features?.loggia));
    }

    if (onlyRc) {
      list = list.filter((p) => normalizeText(getFeatureComplex(p)).length > 0);
    }

    if (rcNeedle) {
      list = list.filter((p) => hasToken(getFeatureComplex(p), rcNeedle));
    }

    // Unified deterministic scoring for both manual and AI paths.
    // Core constraints above are hard gates; score below is calculated only for soft fields.
    const scoreCtx = buildUnifiedScoreContext({
      roomsRaw: rooms,
      minPrice: min,
      maxPrice: max,
      minArea: areaMin,
      maxArea: areaMax,
      minFloor: floorMin,
      maxFloor: floorMax,
      parkingRequired: onlyParking,
      balconyRequired: onlyBalconyLoggia
    });

    const ranked = list.map((p) => annotatePropertyScoresByContext(p, scoreCtx));

    ranked.sort((a, b) => {
      const byScore = Number(b.score || 0) - Number(a.score || 0);
      if (byScore !== 0) return byScore;
      const pa = Number(a.priceEUR);
      const pb = Number(b.priceEUR);
      if (Number.isFinite(pa) && Number.isFinite(pb)) return pa - pb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    res.json({ cards: ranked.slice(0, Number(limit) || 10) });
  } catch (err) {
    console.error('❌ Ошибка в /api/cards/search:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получить карточку по external_id
router.get('/residential-complexes', async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    }
    const q = String(req.query?.q ?? '').trim();
    const limitRaw = Number.parseInt(String(req.query?.limit ?? '50').trim(), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const items = await listResidentialComplexes(SERVICE_CLIENT_ID, { q, limit });
    return res.json({ ok: true, items });
  } catch (error) {
    console.error('GET /api/cards/residential-complexes:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// Получить карточку по external_id
router.get('/:id', async (req, res) => {
  try {
    // trim+upper чтобы /A102%20 работало как /A102
    const requestedId = String(req.params.id || '').trim().toUpperCase();

    const raw = await getPropertyByExternalId(requestedId);

    if (!raw) {
      return res.status(404).json({ error: 'Not found' });
    }

    const item = normalizeProperty(raw);
    res.json(item);
  } catch (err) {
    console.error('❌ Ошибка в /api/cards/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
