import express from 'express';
import properties from '../data/properties.js';

const router = express.Router();

// Простой поиск по фильтрам (город/район/комнаты/тип/ценовой диапазон)
router.get('/search', (req, res) => {
  const { city, district, rooms, type, minPrice, maxPrice, limit = 10 } = req.query;
  const toInt = (v) => (v == null ? null : parseInt(String(v), 10));
  const min = toInt(minPrice);
  const max = toInt(maxPrice);
  const r = toInt(rooms);

  let list = properties.slice();
  if (city) list = list.filter(p => p.city?.toLowerCase() === String(city).toLowerCase());
  if (district) list = list.filter(p => p.district?.toLowerCase() === String(district).toLowerCase());
  if (type) list = list.filter(p => p.type === type);
  if (r != null) list = list.filter(p => Number(p.rooms) === r);
  if (min != null) list = list.filter(p => Number(p.priceEUR) >= min);
  if (max != null) list = list.filter(p => Number(p.priceEUR) <= max);

  res.json({ cards: list.slice(0, Number(limit) || 10) });
});

router.get('/:id', (req, res) => {
  const item = properties.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

export default router;

