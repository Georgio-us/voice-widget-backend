import express from 'express';
import { 
  getAllProperties, 
  getPropertyByExternalId 
} from '../services/propertiesRepository.js';
import { listResidentialComplexes } from '../services/residentialComplexesRepository.js';
import { buildScoreContext as buildUnifiedScoreContext, annotatePropertyScoresByContext } from '../services/scoringEngine.js';
import { normalizeResidentialComplexName, residentialComplexInputToArray } from '../services/residentialComplexMatcher.js';
import {
  compareBrowseCards,
  compareStrictSearchCards,
  getFeatureComplex,
  getTotalFloors,
  hasGovernmentProgram,
  hasValue,
  isTrue,
  normalizeDistrictValue,
  normalizeNeighborhoodValue,
  normalizeOperationValue,
  normalizeProperty,
  normalizeText,
  toQueryArray
} from '../services/propertySearchNormalizer.js';

const router = express.Router();
const SERVICE_CLIENT_ID = String(process.env.CLIENT_ID || '').trim();

// property/card normalization is centralized in services/propertySearchNormalizer.js

const matchesNeighborhoodFlag = (property, target, tokens = []) => {
  const normalizedParts = [
    property?.district,
    property?.neighborhood,
    property?.location_neighborhood,
    property?.title,
    property?.address
  ].map((value) => normalizeNeighborhoodValue(value));
  if (normalizedParts.some((value) => value === target)) return true;

  const haystack = [
    property?.district,
    property?.neighborhood,
    property?.location_neighborhood,
    property?.title,
    property?.address
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  return tokens.some((token) => haystack.includes(token));
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
      microdistrict,
      neighborhood,
      rooms,
      type,
      operation,
      minPrice,
      maxPrice,
      minArea,
      maxArea,
      minLandArea,
      maxLandArea,
      minFloor,
      maxFloor,
      floorNotFirst,
      floorNotLast,
      smart,
      arcadia,
      rcOnly,
      residentialComplex,
      exclusive,
      center,
      parking,
      balconyLoggia,
      governmentProgram,
      eoselia,
      evidnovlennia,
      mode,
      catalogMode,
      view,
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
    const roomsTokens = Array.from(new Set(
      toQueryArray(rooms)
        .map((v) => normalizeText(v))
        .map((v) => {
          if (v === '5+' || v === '5plus') return '5plus';
          if (v === '4+' || v === '4plus') return '4plus';
          const n = toInt(v);
          if (n != null && n >= 1) return String(n);
          return '';
        })
        .filter(Boolean)
    ));
    const districtTokens = Array.from(new Set(
      toQueryArray(district).map((v) => normalizeDistrictValue(v)).filter(Boolean)
    ));
    const microdistrictTokens = Array.from(new Set(
      [
        ...toQueryArray(microdistrict),
        ...toQueryArray(neighborhood)
      ].map((v) => normalizeNeighborhoodValue(v)).filter(Boolean)
    ));
    const areaMin = toNumber(minArea);
    const areaMax = toNumber(maxArea);
    const landAreaMin = toNumber(minLandArea);
    const landAreaMax = toNumber(maxLandArea);
    const floorMin = toInt(minFloor);
    const floorMax = toInt(maxFloor);
    const onlyFloorNotFirst = toBool(floorNotFirst);
    const onlyFloorNotLast = toBool(floorNotLast);
    const onlySmart = toBool(smart);
    const onlyArcadia = toBool(arcadia);
    const onlyRc = toBool(rcOnly);
    const rcNeedles = residentialComplexInputToArray(residentialComplex)
      .map((value) => normalizeResidentialComplexName(value))
      .filter(Boolean);
    const onlyExclusive = toBool(exclusive);
    const onlyCenter = toBool(center);
    const onlyParking = toBool(parking);
    const onlyBalconyLoggia = toBool(balconyLoggia);
    const onlyGovernmentProgram = toBool(governmentProgram);
    const onlyEoselia = toBool(eoselia);
    const onlyEvidnovlennia = toBool(evidnovlennia);
    const browseModeToken = normalizeText(mode || catalogMode || view);
    const forceBrowseMode = ['all', 'allactive', 'active', 'browse', 'default'].includes(browseModeToken);
    const hasSearchFilters = !forceBrowseMode && Boolean(
      hasValue(city)
      || districtTokens.length > 0
      || microdistrictTokens.length > 0
      || hasValue(type)
      || hasValue(operation)
      || roomsTokens.length > 0
      || min != null
      || max != null
      || areaMin != null
      || areaMax != null
      || landAreaMin != null
      || landAreaMax != null
      || floorMin != null
      || floorMax != null
      || onlyFloorNotFirst
      || onlyFloorNotLast
      || onlySmart
      || onlyArcadia
      || onlyRc
      || rcNeedles.length > 0
      || onlyExclusive
      || onlyCenter
      || onlyParking
      || onlyBalconyLoggia
      || onlyGovernmentProgram
      || onlyEoselia
      || onlyEvidnovlennia
    );

    // Берём все объекты клиента из CLIENT_ID env
    const rawList = await getAllProperties();
    let list = rawList.map(normalizeProperty);

    // ---------- filters ----------
    if (city) {
      const c = String(city).toLowerCase().trim();
      list = list.filter(p => p.city && p.city.toLowerCase() === c);
    }

    if (districtTokens.length > 0) {
      list = list.filter((p) => districtTokens.includes(normalizeDistrictValue(p.district)));
    }

    if (microdistrictTokens.length > 0) {
      list = list.filter((p) => {
        const haystack = [
          p.neighborhood,
          p.location_neighborhood,
          p.title
        ].map((value) => String(value || '')).join(' ');
        const normalized = normalizeNeighborhoodValue(haystack);
        return microdistrictTokens.some((token) => normalized === token);
      });
    }

    if (hasSearchFilters || hasValue(type)) {
      const effectiveType = type ? String(type).trim() : 'apartment';
      list = list.filter(p => p.property_type === effectiveType);
    }

    if (hasSearchFilters || hasValue(operation)) {
      const effectiveOp = operation ? normalizeOperationValue(operation) : 'sale';
      list = list.filter((p) => normalizeOperationValue(p.operation) === effectiveOp);
    }

    if (roomsTokens.length > 0) {
      list = list.filter((p) => {
        const roomNum = Number(p.rooms);
        if (!Number.isFinite(roomNum)) return false;
        return roomsTokens.some((token) => {
          if (token === '5plus') return roomNum >= 5;
          if (token === '4plus') return roomNum >= 4;
          const want = toInt(token);
          return want != null && roomNum === want;
        });
      });
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

    if (landAreaMin != null) {
      list = list.filter((p) => Number(p.land_area_sotka) >= landAreaMin);
    }

    if (landAreaMax != null) {
      list = list.filter((p) => Number(p.land_area_sotka) <= landAreaMax);
    }

    if (floorMin != null) {
      list = list.filter((p) => Number(p.floor) >= floorMin);
    }

    if (floorMax != null) {
      list = list.filter((p) => Number(p.floor) <= floorMax);
    }

    if (onlyFloorNotFirst) {
      list = list.filter((p) => {
        const floor = toInt(p?.floor);
        if (!Number.isFinite(floor)) return false;
        return floor > 1;
      });
    }

    if (onlyFloorNotLast) {
      list = list.filter((p) => {
        const floor = toInt(p?.floor);
        if (!Number.isFinite(floor)) return false;
        const totalFloors = getTotalFloors(p);
        // Product rule: apply "not last" only when total floors are known.
        if (Number.isFinite(totalFloors) && totalFloors > 1) {
          return floor < totalFloors;
        }
        return true;
      });
    }

    if (onlySmart) {
      list = list.filter((p) => p?.features?.smartFlat === true);
    }

    if (onlyArcadia) {
      list = list.filter((p) => matchesNeighborhoodFlag(p, 'arcadia', ['аркад', 'arcad']));
    }

    if (onlyExclusive) {
      list = list.filter((p) => isTrue(p?.features?.exclusive));
    }

    if (onlyCenter) {
      list = list.filter((p) => matchesNeighborhoodFlag(p, 'center', ['центр', 'center', 'central']));
    }

    if (onlyParking) {
      list = list.filter((p) => isTrue(p?.features?.parking));
    }

    if (onlyBalconyLoggia) {
      list = list.filter((p) => isTrue(p?.balcony) || isTrue(p?.features?.balcony) || isTrue(p?.features?.loggia));
    }

    if (onlyGovernmentProgram) {
      list = list.filter((p) => hasGovernmentProgram(p));
    }

    if (onlyEoselia) {
      list = list.filter((p) => hasGovernmentProgram(p, 'eoselia'));
    }

    if (onlyEvidnovlennia) {
      list = list.filter((p) => hasGovernmentProgram(p, 'evidnovlennia'));
    }

    if (onlyRc) {
      list = list.filter((p) => normalizeText(getFeatureComplex(p)).length > 0);
    }

    if (rcNeedles.length > 0) {
      list = list.filter((p) => {
        const complex = normalizeResidentialComplexName(getFeatureComplex(p));
        return !!complex && rcNeedles.some((needle) => complex === needle || complex.includes(needle));
      });
    }

    // Strict mode if at least one manual filter is actually set.
    // Browse mode if query has no filters (except limit).
    const hasStrictFilters = hasSearchFilters;

    // Unified deterministic scoring for both manual and AI paths.
    // Core constraints above are hard gates; score below is calculated only for soft fields.
    const scoreCtx = buildUnifiedScoreContext({
      roomsRaw: roomsTokens[0] || (Array.isArray(rooms) ? rooms[0] : rooms),
      minPrice: min,
      maxPrice: max,
      minArea: areaMin,
      maxArea: areaMax,
      minLandArea: landAreaMin,
      maxLandArea: landAreaMax,
      minFloor: floorMin,
      maxFloor: floorMax,
      parkingRequired: onlyParking,
      balconyRequired: onlyBalconyLoggia
    });

    const ranked = list.map((p) => annotatePropertyScoresByContext(p, scoreCtx));

    if (hasStrictFilters) {
      // Strict mode sorting:
      // 1) cheapest first (price ASC)
      // 2) smaller area first (area ASC)
      // 3) stable id fallback
      ranked.sort(compareStrictSearchCards);
    } else {
      // Browse mode sorting:
      // 1) newest first by created_at
      // 2) then by internal db id DESC
      // 3) then by external id DESC for deterministic fallback
      ranked.sort(compareBrowseCards);
    }

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
    const lang = String(req.query?.lang ?? 'ua').trim().toLowerCase().slice(0, 2) === 'ru' ? 'ru' : 'ua';
    const limitRaw = Number.parseInt(String(req.query?.limit ?? '50').trim(), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const items = await listResidentialComplexes(SERVICE_CLIENT_ID, { q, limit, lang });
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
