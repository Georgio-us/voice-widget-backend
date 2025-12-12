import express from 'express';
import { 
  getAllProperties, 
  getPropertyByExternalId 
} from '../services/propertiesRepository.js';

const router = express.Router();

/**
 * Нормализация объекта из БД (Postgres)
 * + поддержка legacy-формата (если где-то ещё используется)
 */
const normalizeProperty = (p) => {
  // ---------- images ----------
  let images = [];
  try {
    if (Array.isArray(p.images)) {
      images = p.images;
    } else if (typeof p.images === 'string') {
      images = JSON.parse(p.images);
    }
  } catch {
    images = [];
  }

  // ---------- id ----------
  const id = p.external_id ?? p.id ?? null;

  // ---------- location ----------
  const city = p.location?.city ?? p.location_city ?? null;
  const district = p.location?.district ?? p.location_district ?? null;
  const neighborhood = p.location?.neighborhood ?? p.location_neighborhood ?? null;
  const address = p.location?.address ?? p.location_address ?? null;

  // ---------- specs ----------
  const rooms = p.specs?.rooms ?? p.specs_rooms ?? null;
  const bathrooms = p.specs?.bathrooms ?? p.specs_bathrooms ?? null;
  const area_m2 = p.specs?.area_m2 ?? p.specs_area_m2 ?? null;
  const floor = p.specs?.floor ?? p.specs_floor ?? null;
  const balcony = p.specs?.balcony ?? p.specs_balcony ?? null;
  const terrace = p.specs?.terrace ?? p.specs_terrace ?? null;

  // ---------- price ----------
  const priceEUR =
    p.price?.amount ??
    p.price_amount ??
    p.priceEUR ??
    null;

  return {
    id,
    operation: p.operation ?? null,
    property_type: p.property_type ?? null,
    furnished: p.furnished ?? null,

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
    price_per_m2: p.price_per_m2 ?? null,

    // texts
    title: p.title ?? null,
    description: p.description ?? null,

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
      const c = String(city).toLowerCase();
      list = list.filter(p => p.city && p.city.toLowerCase() === c);
    }

    if (district) {
      const d = String(district).toLowerCase();
      list = list.filter(p => p.district && p.district.toLowerCase() === d);
    }

    if (type) {
      list = list.filter(p => p.property_type === type);
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
    const raw = await getPropertyByExternalId(req.params.id);

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