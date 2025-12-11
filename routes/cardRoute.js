import express from 'express';
import { 
  getAllProperties, 
  getPropertyByExternalId 
} from '../services/propertiesRepository.js';

const router = express.Router();

// Приводим raw-объект из Базы Данных к формату карточек,
// максимально близкому к тому, что раньше было в properties.js
const normalizeProperty = (p) => ({
  id: p.id,
  operation: p.operation,
  property_type: p.property_type,
  furnished: p.furnished ?? null,

  // Локация
  city: p.location?.city ?? null,
  district: p.location?.district ?? null,
  neighborhood: p.location?.neighborhood ?? null,
  address: p.location?.address ?? null,

  // Характеристики
  rooms: p.specs?.rooms ?? null,
  bathrooms: p.specs?.bathrooms ?? null,
  area_m2: p.specs?.area_m2 ?? null,
  floor: p.specs?.floor ?? null,
  balcony: p.specs?.balcony ?? null,
  terrace: p.specs?.terrace ?? null,

  // Цена
  priceEUR: p.price?.amount ?? null,
  price_per_m2: p.price_per_m2 ?? null,

  // Тексты
  title: p.title ?? null,
  description: p.description ?? null,

  // Картинки
  images: Array.isArray(p.images) ? p.images : [],
});

// ===============================
//        ROUTES
// ===============================

// Поиск по фильтрам (город, район, комнаты, тип, цена)
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

    // Фильтры
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

// Получить карточку по ID
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