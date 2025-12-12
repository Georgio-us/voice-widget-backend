import express from 'express';
import { 
  getAllProperties, 
  getPropertyByExternalId 
} from '../services/propertiesRepository.js';

const router = express.Router();

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
  const description = toText(p.description);

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

    // price
    priceEUR,
    price_per_m2,

    // texts
    title,
    description,

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
    const { city, district, rooms, type, minPrice, maxPrice, limit = 10 } = req.query;

    const toInt = (v) => (v == null ? null : parseInt(String(v), 10));
    const min = toInt(minPrice);
    const max = toInt(maxPrice);
    const r = toInt(rooms);

    // Берём все объекты клиента demo из БД
    const rawList = await getAllProperties();
    let list = rawList.map(normalizeProperty);

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