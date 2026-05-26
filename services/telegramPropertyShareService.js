import { getPropertyByExternalId } from './propertiesRepository.js';

export function normalizePropId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toUpperCase();
}

function parseImages(rawImages) {
  if (Array.isArray(rawImages)) return rawImages.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof rawImages === 'string') {
    const text = rawImages.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
    } catch {}
    return text.split(',').map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

function formatPriceLabel(raw) {
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return `${Math.round(num).toLocaleString('en-US')} USD`;
  const text = String(raw || '').trim();
  return text || 'Price on request';
}

function formatPropertyTypeRu(rawType) {
  const type = String(rawType || '').trim().toLowerCase();
  if (!type) return 'Объект';
  if (['apartment', 'flat'].includes(type)) return 'Квартира';
  if (type === 'house') return 'Дом';
  if (type === 'commercial') return 'Коммерция';
  if (type === 'land') return 'Земля';
  if (type === 'parking') return 'Паркинг';
  return String(rawType || '').trim() || 'Объект';
}

export function formatRoomsRu(rawRooms) {
  const n = Number(rawRooms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const v = Math.round(n);
  const suffix = v === 1 ? 'комната' : (v >= 2 && v <= 4 ? 'комнаты' : 'комнат');
  return `${v} ${suffix}`;
}

function formatAreaM2(rawArea) {
  const n = Number(rawArea);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const text = Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '').replace('.', ',');
  return `${text} м²`;
}

function formatPositiveNumber(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return '';
  const n = Number(String(rawValue).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '';
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '').replace('.', ',');
}

function readLandAreaSotka(raw = {}) {
  const features = raw?.features && typeof raw.features === 'object' && !Array.isArray(raw.features) ? raw.features : {};
  const displaySpecs = features.display_specs && typeof features.display_specs === 'object' ? features.display_specs : {};
  const candidates = [
    raw.land_area_sotka,
    raw.landAreaSotka,
    features.land_area_sotka,
    features.landAreaSotka,
    displaySpecs.land_area_sotka,
    displaySpecs.landAreaSotka
  ];
  for (const candidate of candidates) {
    const formatted = formatPositiveNumber(candidate);
    if (formatted) return formatted;
  }
  return '';
}

export function buildAreaTextRu(property = {}) {
  const type = String(property.propertyType || '').trim().toLowerCase();
  const isHouse = type === 'house';
  const isLand = type === 'land';
  const parts = [];
  if (!isLand) {
    const area = formatAreaM2(property.areaM2);
    if (area && area !== '—') parts.push(isHouse ? `дом ${area}` : area);
  }
  if (isHouse || isLand) {
    const landArea = formatPositiveNumber(property.landAreaSotka);
    if (landArea) parts.push(`участок ${landArea} сот.`);
  }
  return parts.join('; ') || '—';
}

export function isValidPublicImageUrl(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\//i.test(value)) return false;
  if (value.includes('<backend-host>')) return false;
  return true;
}

export async function getPropertyForInlineShare(propId) {
  console.log('--- DB SEARCH --- Searching for external_id:', propId, 'AND client_id:', process.env.CLIENT_ID);
  const raw = await getPropertyByExternalId(propId);
  console.log('--- DB RESULT --- Found object:', raw ? `YES (ID: ${raw.external_id || raw.id})` : 'NO (NULL)');
  if (!raw) return null;
  const images = parseImages(raw.images);
  const geo = raw && raw.geo && typeof raw.geo === 'object' ? raw.geo : null;
  return {
    id: normalizePropId(raw.external_id || raw.id),
    title: String(raw.title || '').trim(),
    propertyType: String(raw.property_type || 'property').trim(),
    propertyTypeLabel: formatPropertyTypeRu(raw.property_type || 'property'),
    city: String(geo?.city || raw.location_city || '').trim(),
    district: String(geo?.district || raw.location_district || raw.location_neighborhood || '').trim(),
    neighborhood: String(geo?.neighborhood || raw.location_neighborhood || '').trim(),
    rooms: Number(raw.specs_rooms ?? raw.rooms ?? 0) || null,
    areaM2: Number(raw.specs_area_m2 ?? raw.area_m2 ?? raw.area ?? 0) || null,
    landAreaSotka: readLandAreaSotka(raw),
    priceLabel: formatPriceLabel(raw.price_amount),
    image: images[0] || ''
  };
}
