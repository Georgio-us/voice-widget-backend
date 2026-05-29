export const getBaseUrl = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return host ? `${proto}://${host}` : '';
};

export const formatNumberUS = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric).toLocaleString('en-US');
};

export const detectBudgetCurrency = (text = '') => {
  const s = String(text || '').toLowerCase();
  if (/\b(uah|грн|гривн|гривня|гривні|гривен)\b/.test(s) || /₴/.test(s)) return 'UAH';
  if (/(\$|\busd\b|\bdollar\b|\bdollars\b|доллар|доллара|долларов)/.test(s)) return 'USD';
  return 'USD';
};

export const formatCardForClient = (req, p) => {
  const baseUrl = getBaseUrl(req);
  const images = (Array.isArray(p.images) ? p.images : [])
    .map((src) => String(src || '').trim())
    .filter(Boolean)
    .map((src) => src.replace('https://<backend-host>', baseUrl));
  const image = images.length ? images[0] : null;
  const formattedPrice = formatNumberUS(p.priceEUR ?? p?.price?.amount);
  return {
    id: p.id,
    city: p.city ?? p?.location?.city ?? null,
    district: p.district ?? p?.location?.district ?? null,
    neighborhood: p.neighborhood ?? p?.location?.neighborhood ?? null,
    operation: p.operation ?? null,
    property_type: p.property_type ?? null,
    price: formattedPrice ? `${formattedPrice} USD` : null,
    priceEUR: p.priceEUR ?? p?.price?.amount ?? null,
    rooms: p.rooms ?? p?.specs?.rooms ?? null,
    floor: p.floor ?? p?.specs?.floor ?? null,
    description: p.description ?? null,
    area_m2: p.area_m2 ?? p?.specs?.area_m2 ?? null,
    land_area_sotka: p.land_area_sotka ?? p.landAreaSotka ?? p?.specs?.land_area_sotka ?? p?.features?.landAreaSotka ?? p?.features?.land_area_sotka ?? null,
    landAreaSotka: p.landAreaSotka ?? p.land_area_sotka ?? p?.specs?.land_area_sotka ?? p?.features?.landAreaSotka ?? p?.features?.land_area_sotka ?? null,
    price_per_m2: p.price_per_m2 ?? null,
    bathrooms: p.bathrooms ?? p?.specs?.bathrooms ?? null,
    features: p.features ?? null,
    geo: p.geo ?? null,
    price_period: p.price_period ?? null,
    score: p._score ?? p.score ?? 0,
    strictScore: p._strictScore ?? p.strictScore ?? 0,
    matchTier: p._tier ?? p.matchTier ?? 'low',
    image,
    imageUrl: image,
    images
  };
};
