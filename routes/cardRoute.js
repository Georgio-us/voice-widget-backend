import express from 'express';
import { 
  getAllProperties, 
  getPropertyByExternalId 
} from '../services/propertiesRepository.js';

const router = express.Router();

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const DISTRICT_ALIASES = new Map([
  ['primorsky', 'приморский'],
  ['primorskiy', 'приморский'],
  ['primorski', 'приморский'],
  ['приморский', 'приморский'],
  ['kievsky', 'киевский'],
  ['kyivskyi', 'киевский'],
  ['киевский', 'киевский'],
  ['suvorovsky', 'суворовский'],
  ['suvorovskiy', 'суворовский'],
  ['суворовский', 'суворовский'],
  ['malinovsky', 'малиновский'],
  ['malinovskiy', 'малиновский'],
  ['малиновский', 'малиновский'],
  ['tairovo', 'киевский'],
  ['таирово', 'киевский']
]);
const normalizeDistrictValue = (value) => {
  const key = normalizeText(value);
  return DISTRICT_ALIASES.get(key) || key;
};
const hasToken = (value, token) => normalizeText(value).includes(normalizeText(token));

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
  const area_m2 = toInt(p.specs?.area_m2 ?? feat.areaM2 ?? p.specs_area_m2);
  const floor = toInt(p.specs?.floor ?? feat.floor ?? p.specs_floor);
  const balcony = toBool(p.specs?.balcony ?? feat.balcony ?? p.specs_balcony);
  const terrace = toBool(p.specs?.terrace ?? feat.terrace ?? p.specs_terrace);

  // ---------- price ----------
  const priceEUR = toInt(
    p.price?.amount ??
    p.price_amount ??
    p.priceEUR
  );

  const price_per_m2 = toInt(p.price_per_m2);

  // ---------- operation / property_type / furnished ----------
  // trim, чтобы убрать " sale " / " apartment " из XLSX
  const operation = toText(p.operation);
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
    priceEUR,
    price_per_m2,

    // texts
    title,
    description,

    // images
    images,

    // raw features subset for advanced filters
    features: {
      smartFlat: feat.smartFlat === true,
      complex: toText(feat.complex)
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
    const toBool = (v) => {
      const raw = normalizeText(v);
      return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
    };
    const min = toInt(minPrice);
    const max = toInt(maxPrice);
    const r = toInt(rooms);
    const areaMin = toInt(minArea);
    const areaMax = toInt(maxArea);
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
      const want = normalizeText(operation);
      list = list.filter((p) => normalizeText(p.operation) === want);
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
      list = list.filter((p) => p?.features?.smartFlat === true || hasToken(p.title, 'смарт') || hasToken(p.description, 'смарт') || hasToken(p.title, 'smart') || hasToken(p.description, 'smart'));
    }

    if (onlyArcadia) {
      list = list.filter((p) => hasToken(p.neighborhood, 'аркад') || hasToken(p.address, 'аркад') || hasToken(p.title, 'аркад') || hasToken(p.description, 'аркад') || hasToken(p.neighborhood, 'arcad') || hasToken(p.address, 'arcad'));
    }

    if (onlyExclusive) {
      list = list.filter((p) => hasToken(p.title, 'эксклюзив') || hasToken(p.description, 'эксклюзив') || hasToken(p.title, 'exclusive') || hasToken(p.description, 'exclusive'));
    }

    if (onlyCenter) {
      list = list.filter((p) => hasToken(p.neighborhood, 'центр') || hasToken(p.address, 'центр') || hasToken(p.title, 'центр') || hasToken(p.description, 'центр'));
    }

    if (onlyParking) {
      list = list.filter((p) => hasToken(p.title, 'паркинг') || hasToken(p.description, 'паркинг') || hasToken(p.title, 'parking') || hasToken(p.description, 'parking'));
    }

    if (onlyBalconyLoggia) {
      list = list.filter((p) => p.balcony === true || hasToken(p.title, 'балкон') || hasToken(p.description, 'балкон') || hasToken(p.title, 'лодж') || hasToken(p.description, 'лодж'));
    }

    if (onlyRc) {
      list = list.filter((p) => {
        const complex = normalizeText(p?.features?.complex);
        return !!complex || hasToken(p.title, 'жк') || hasToken(p.description, 'жк');
      });
    }

    if (rcNeedle) {
      list = list.filter((p) => hasToken(p?.features?.complex, rcNeedle) || hasToken(p.title, rcNeedle) || hasToken(p.description, rcNeedle));
    }

    res.json({ cards: list.slice(0, Number(limit) || 10) });
  } catch (err) {
    console.error('❌ Ошибка в /api/cards/search:', err);
    res.status(500).json({ error: 'Internal server error' });
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
