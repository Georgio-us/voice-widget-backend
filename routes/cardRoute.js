import express from 'express';
import { 
  getAllProperties, 
  getPropertyByExternalId 
} from '../services/propertiesRepository.js';

const router = express.Router();

const normalizeUiLang = (v) => {
  const s = String(v || '').trim().slice(0, 2).toLowerCase();
  if (s === 'en' || s === 'es') return s;
  return 'ru';
};

const getRequestUiLang = (req) => {
  const queryLang = req?.query?.lang || req?.query?.language;
  if (queryLang) return normalizeUiLang(queryLang);
  const headerLang = req?.headers?.['x-widget-lang'] || req?.headers?.['accept-language'];
  if (headerLang) return normalizeUiLang(String(headerLang).split(',')[0]);
  return 'ru';
};

/**
 * Нормализация объекта из БД (Postgres)
 * + поддержка legacy-формата (если где-то ещё используется)
 * + приведение типов (int / boolean), чтобы UI и фильтры работали корректно
 * + trim/cleanup строк (убираем пробелы из XLSX типа "A102 ")
 */
const normalizeProperty = (p, uiLang = 'ru') => {

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

  // ---------- id ----------
  // важно: trim + (опционально) upperCase, чтобы A102 " и A102 были одним и тем же
  const idRaw = p.external_id ?? p.id ?? null;
  const id = (() => {
    const s = toText(idRaw);
    return s ? s.toUpperCase() : null;
  })();

  // ---------- location ----------
  const city = toText(p.location?.city ?? p.location_city);
  const district = toText(p.location?.district ?? p.location_district);
  const neighborhood = toText(p.location?.neighborhood ?? p.location_neighborhood);
  const address = toText(p.location?.address ?? p.location_address);

  // ---------- specs ----------
  const rooms = toInt(p.specs?.rooms ?? p.specs_rooms);
  const bathrooms = toInt(p.specs?.bathrooms ?? p.specs_bathrooms);
  const area_m2 = toInt(p.specs?.area_m2 ?? p.specs_area_m2);
  const floor = toInt(p.specs?.floor ?? p.specs_floor);
  const balcony = toBool(p.specs?.balcony ?? p.specs_balcony);
  const terrace = toBool(p.specs?.terrace ?? p.specs_terrace);

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
  const rawObj = p.raw && typeof p.raw === 'object'
    ? p.raw
    : (typeof p.raw === 'string'
        ? (() => { try { return JSON.parse(p.raw); } catch { return null; } })()
        : null);
  const tags = Array.isArray(rawObj?.tags)
    ? rawObj.tags.map((v) => toText(v)).filter(Boolean).slice(0, 4)
    : [];
  const year_built = toInt(p.building_year ?? rawObj?.yearBuild);
  const orientation = toText(rawObj?.orientation);
  const distance_beach = toInt(rawObj?.distanceBeach);
  const distance_airport = toInt(rawObj?.distanceAirport);
  const distance_golf = toInt(rawObj?.distanceGolf);
  const distance_amenities = toInt(rawObj?.distanceAmenities);
  const descriptionI18n = rawObj?.descriptionI18n && typeof rawObj.descriptionI18n === 'object'
    ? rawObj.descriptionI18n
    : null;
  const description = toText(
    (descriptionI18n && descriptionI18n[uiLang]) ||
    (descriptionI18n && descriptionI18n.ru) ||
    p.description
  );

  return {
    id,
    operation,
    property_type,
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
    year_built,
    orientation,
    distance_beach,
    distance_airport,
    distance_golf,
    distance_amenities,

    // price
    priceEUR,
    price_per_m2,

    // texts
    title,
    description,
    tags,

    // images
    images
  };
};

// ===============================
//            ROUTES
// ===============================

// Поиск по фильтрам
router.get('/search', async (req, res) => {
  try {
    const uiLang = getRequestUiLang(req);
    const { city, district, rooms, type, minPrice, maxPrice, limit = 10 } = req.query;

    const toInt = (v) => (v == null ? null : parseInt(String(v), 10));
    const min = toInt(minPrice);
    const max = toInt(maxPrice);
    const r = toInt(rooms);

    // Берём все объекты клиента demo из БД
    const rawList = await getAllProperties();
    let list = rawList.map((item) => normalizeProperty(item, uiLang));

    // ---------- filters ----------
    if (city) {
      const c = String(city).toLowerCase().trim();
      list = list.filter(p => p.city && p.city.toLowerCase() === c);
    }

    if (district) {
      const d = String(district).toLowerCase().trim();
      list = list.filter(p => p.district && p.district.toLowerCase() === d);
    }

    if (type) {
      const t = String(type).trim();
      list = list.filter(p => p.property_type === t);
    }

    if (r != null) {
      list = list.filter(p => Number(p.rooms) === r);
    }

    if (min != null) {
      list = list.filter(p => Number(p.priceEUR) >= min);
    }

    if (max != null) {
      list = list.filter(p => Number(p.priceEUR) <= max);
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
    const uiLang = getRequestUiLang(req);
    // trim+upper чтобы /A102%20 работало как /A102
    const requestedId = String(req.params.id || '').trim().toUpperCase();

    const raw = await getPropertyByExternalId(requestedId);

    if (!raw) {
      return res.status(404).json({ error: 'Not found' });
    }

    const item = normalizeProperty(raw, uiLang);
    res.json(item);
  } catch (err) {
    console.error('❌ Ошибка в /api/cards/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
