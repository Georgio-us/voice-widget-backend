import { getAllProperties } from './propertiesRepository.js';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DEFAULT_CLIENT_ID = 'demo';
const DEFAULT_MAX_ITEMS = 120;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = {
  key: null,
  expiresAt: 0,
  value: null
};

const isEnabled = () => TRUE_VALUES.has(String(process.env.DEMO_CATALOG_CONTEXT_ENABLED || '').trim().toLowerCase());

const getTargetClientId = () => String(
  process.env.DEMO_CATALOG_CONTEXT_CLIENT_ID ||
  DEFAULT_CLIENT_ID
).trim();

const getMaxItems = () => {
  const parsed = Number.parseInt(String(process.env.DEMO_CATALOG_CONTEXT_MAX_ITEMS || '').trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ITEMS;
  return Math.min(Math.max(parsed, 1), 300);
};

const parseJsonObject = (value) => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const toText = (value) => String(value ?? '').trim();

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const truthy = (value) => value === true || value === 1 || ['true', '1', 'yes', 'on'].includes(String(value || '').toLowerCase());

const normalizeOperationForContext = (value) => {
  const raw = toText(value).toLowerCase();
  if (raw === 'sale') return 'sale';
  if (raw === 'rent') return 'rent';
  return raw || 'unknown';
};

const formatPrice = (value) => {
  const n = toNumberOrNull(value);
  return n == null ? '-' : `$${Math.round(n)}`;
};

const compact = (value, max = 90) => {
  const text = toText(value).replace(/\s+/g, ' ');
  if (!text) return '-';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const getComplex = (features) => (
  toText(features?.complex) ||
  toText(features?.residentialComplex) ||
  toText(features?.display_specs?.complex)
);

const toCatalogItem = (row) => {
  const features = parseJsonObject(row.features);
  const geo = parseJsonObject(row.geo);
  const district = toText(row.location_district) || toText(geo.district);
  const neighborhood = toText(row.location_neighborhood) || toText(geo.neighborhood);
  const complex = getComplex(features);
  const rooms = toNumberOrNull(row.specs_rooms ?? features.rooms);
  const area = toNumberOrNull(row.specs_area_m2 ?? features.areaM2);
  const flags = [];
  if (complex) flags.push('rc');
  if (truthy(features.arcadia) || /аркад/i.test(neighborhood)) flags.push('arcadia');
  if (truthy(features.center) || /центр/i.test(neighborhood)) flags.push('center');
  if (truthy(features.tairovo) || /таиров/i.test(neighborhood)) flags.push('tairovo');
  if (truthy(features.kotovsky) || /котовск/i.test(neighborhood)) flags.push('kotovsky');
  if (truthy(features.parking)) flags.push('parking');
  if (truthy(features.balconyLoggia) || truthy(features.balcony) || truthy(features.loggia)) flags.push('balcony');

  return {
    id: toText(row.external_id),
    operation: normalizeOperationForContext(row.operation),
    type: toText(row.property_type) || 'unknown',
    title: compact(row.title, 96),
    district: district || '-',
    neighborhood: neighborhood || '-',
    complex: complex || '-',
    rooms: rooms == null ? '-' : `${rooms}к`,
    area: area == null ? '-' : `${area}м2`,
    price: formatPrice(row.price_amount),
    flags
  };
};

const buildPromptBlock = (items, meta) => {
  const lines = items.map((item) => [
    item.id,
    `${item.operation}/${item.type}`,
    `${item.rooms}`,
    `${item.area}`,
    item.price,
    `${item.district}/${item.neighborhood}`,
    `ЖК:${item.complex}`,
    `flags:${item.flags.join(',') || '-'}`,
    `title:${item.title}`
  ].join(' | '));

  return [
    'DEMO CATALOG CONTEXT (client_id=demo, compact snapshot; use only for extraction and constraint mapping, not as final availability statement):',
    `Scope: active visible demo catalog, sale/apartment. Items included: ${meta.itemsIncluded}/${meta.totalVisible}.`,
    'Rules:',
    '- Use this catalog to recognize complex names, district/micro-area intent, room/price/feature constraints.',
    '- Do not quote exact catalog contents to the user unless server results later provide cards.',
    '- Do not search descriptions; rely on title, complex, district, neighborhood, specs and flags.',
    '- If a user names a complex from this list, set residentialComplex to the listed ЖК name.',
    '- If user mentions Аркадия/Центр/Таирово/Котовского, map it to the matching canonical field/flag.',
    'Items:',
    ...lines
  ].join('\n');
};

export async function buildDemoCatalogContext(clientId) {
  const safeClientId = String(clientId || process.env.CLIENT_ID || '').trim();
  const targetClientId = getTargetClientId();
  const enabled = isEnabled();
  const maxItems = getMaxItems();
  const debugEnabled = TRUE_VALUES.has(String(process.env.DEMO_CATALOG_CONTEXT_DEBUG || '').trim().toLowerCase());
  const baseMeta = {
    enabled,
    applied: false,
    debugEnabled,
    clientId: safeClientId || null,
    targetClientId,
    maxItems,
    totalVisible: 0,
    itemsIncluded: 0,
    reason: null
  };

  if (!enabled) return { content: '', meta: { ...baseMeta, reason: 'disabled' } };
  if (!safeClientId || safeClientId !== targetClientId) {
    return { content: '', meta: { ...baseMeta, reason: 'client_mismatch' } };
  }

  const cacheKey = `${safeClientId}:${maxItems}`;
  const now = Date.now();
  if (cache.key === cacheKey && cache.value && cache.expiresAt > now) {
    return cache.value;
  }

  const rows = await getAllProperties(safeClientId);
  const visibleRows = rows
    .filter((row) => normalizeOperationForContext(row.operation) === 'sale')
    .filter((row) => toText(row.property_type) === 'apartment');
  const items = visibleRows
    .slice()
    .sort((a, b) => String(a.external_id || '').localeCompare(String(b.external_id || ''), undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, maxItems)
    .map(toCatalogItem)
    .filter((item) => item.id && item.title);

  const meta = {
    ...baseMeta,
    applied: items.length > 0,
    totalVisible: visibleRows.length,
    itemsIncluded: items.length,
    reason: items.length > 0 ? 'applied' : 'empty_catalog'
  };
  const value = {
    content: items.length > 0 ? buildPromptBlock(items, meta) : '',
    meta
  };
  cache = {
    key: cacheKey,
    expiresAt: now + CACHE_TTL_MS,
    value
  };
  return value;
}
