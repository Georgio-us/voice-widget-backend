import { SCORE_WEIGHTS, SCORE_BANDS, resolveTierByScore } from './scoringConfig.js';

const clamp01 = (n) => {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
};

export const scoreByRelativeDistance = (
  actual,
  target,
  preferred = SCORE_BANDS.preferred,
  acceptable = SCORE_BANDS.acceptable
) => {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return null;
  const ratio = Math.abs(actual - target) / target;
  if (ratio <= preferred) return 1;
  if (ratio <= acceptable) {
    const span = Math.max(0.0001, acceptable - preferred);
    return 1 - ((ratio - preferred) / span) * 0.35;
  }
  const overflowSpan = Math.max(0.0001, acceptable);
  const overflow = (ratio - acceptable) / overflowSpan;
  return clamp01(0.65 - overflow * 0.65);
};

const isTrue = (value) => value === true || value === 'true' || value === 1 || value === '1';

const getAmenityFlags = (property = {}) => {
  const features = property?.features && typeof property.features === 'object' ? property.features : {};
  const text = `${String(property?.description || '').toLowerCase()} ${JSON.stringify(features || {}).toLowerCase()}`;
  const parking = isTrue(features?.parking) || isTrue(features?.has_parking) || /(parking|паркинг|парковк|паркомест|парко ?місц)/i.test(text);
  const balcony = isTrue(features?.balcony) || isTrue(features?.has_balcony) || isTrue(features?.loggia) || /(balcony|балкон|лоджи|лоджія|loggia)/i.test(text);
  return { parking, balcony };
};

export const buildScoreContext = ({
  roomsRaw,
  minPrice,
  maxPrice,
  minArea,
  maxArea,
  minFloor,
  maxFloor,
  parkingRequired,
  balconyRequired
}) => {
  const hasRooms = String(roomsRaw || '').trim() !== '';
  const hasBudget = Number.isFinite(minPrice) || Number.isFinite(maxPrice);
  const hasArea = Number.isFinite(minArea) || Number.isFinite(maxArea);
  const hasFloor = Number.isFinite(minFloor) || Number.isFinite(maxFloor);
  const hasParking = parkingRequired === true;
  const hasBalcony = balconyRequired === true;

  const fields = {
    rooms: hasRooms,
    budget: hasBudget,
    area: hasArea,
    floor: hasFloor,
    parking: hasParking,
    balcony: hasBalcony
  };

  const weightSum = Object.entries(SCORE_WEIGHTS).reduce((acc, [key, weight]) => (
    fields[key] ? acc + weight : acc
  ), 0);

  const budgetAnchor = Number.isFinite(minPrice) && Number.isFinite(maxPrice)
    ? (minPrice + maxPrice) / 2
    : (Number.isFinite(maxPrice) ? maxPrice : (Number.isFinite(minPrice) ? minPrice : null));
  const areaAnchor = Number.isFinite(minArea) && Number.isFinite(maxArea)
    ? (minArea + maxArea) / 2
    : (Number.isFinite(minArea) ? minArea : (Number.isFinite(maxArea) ? maxArea : null));
  const floorAnchor = Number.isFinite(minFloor) && Number.isFinite(maxFloor)
    ? (minFloor + maxFloor) / 2
    : (Number.isFinite(minFloor) ? minFloor : (Number.isFinite(maxFloor) ? maxFloor : null));

  return {
    fields,
    weightSum,
    roomsRaw: String(roomsRaw || '').trim(),
    minPrice,
    maxPrice,
    minArea,
    maxArea,
    minFloor,
    maxFloor,
    budgetAnchor,
    areaAnchor,
    floorAnchor
  };
};

export const scorePropertyByContext = (property, ctx, mode = 'relaxed') => {
  const strictMode = mode === 'strict';
  if (!ctx || !Number.isFinite(ctx.weightSum) || ctx.weightSum <= 0) return 100;

  let weighted = 0;
  const add = (field, match) => {
    if (!ctx.fields[field]) return;
    weighted += SCORE_WEIGHTS[field] * clamp01(match);
  };

  if (ctx.fields.rooms) {
    const actual = Number(property?.rooms);
    const rr = String(ctx.roomsRaw || '');
    let score = 0;
    if (Number.isFinite(actual)) {
      if (rr === '4plus' || rr === '5plus') {
        const threshold = rr === '5plus' ? 5 : 4;
        if (actual >= threshold) score = 1;
        else if (!strictMode && actual === threshold - 1) score = 0.35;
      } else {
        const expected = Number(rr);
        if (Number.isFinite(expected)) {
          const diff = Math.abs(actual - expected);
          if (diff === 0) score = 1;
          else if (!strictMode && diff === 1) score = 0.35;
        }
      }
    }
    add('rooms', score);
  }

  if (ctx.fields.budget) {
    const actual = Number(property?.priceEUR);
    let score = 0;
    if (Number.isFinite(actual) && actual > 0) {
      if (strictMode) {
        const passMin = !Number.isFinite(ctx.minPrice) || actual >= ctx.minPrice;
        const passMax = !Number.isFinite(ctx.maxPrice) || actual <= ctx.maxPrice;
        score = passMin && passMax ? 1 : 0;
      } else {
        score = scoreByRelativeDistance(actual, ctx.budgetAnchor) ?? 0;
      }
    }
    add('budget', score);
  }

  if (ctx.fields.area) {
    const actual = Number(property?.area_m2);
    let score = 0;
    if (Number.isFinite(actual) && actual > 0) {
      if (strictMode) {
        const passMin = !Number.isFinite(ctx.minArea) || actual >= ctx.minArea;
        const passMax = !Number.isFinite(ctx.maxArea) || actual <= ctx.maxArea;
        score = passMin && passMax ? 1 : 0;
      } else {
        score = scoreByRelativeDistance(actual, ctx.areaAnchor) ?? 0;
      }
    }
    add('area', score);
  }

  if (ctx.fields.floor) {
    const actual = Number(property?.floor);
    let score = 0;
    if (Number.isFinite(actual) && actual > 0) {
      if (strictMode) {
        const passMin = !Number.isFinite(ctx.minFloor) || actual >= ctx.minFloor;
        const passMax = !Number.isFinite(ctx.maxFloor) || actual <= ctx.maxFloor;
        score = passMin && passMax ? 1 : 0;
      } else {
        score = scoreByRelativeDistance(actual, ctx.floorAnchor, 0.15, 0.35) ?? 0;
      }
    }
    add('floor', score);
  }

  const amenity = getAmenityFlags(property);
  if (ctx.fields.parking) add('parking', amenity.parking ? 1 : 0);
  if (ctx.fields.balcony) add('balcony', amenity.balcony ? 1 : 0);

  return Math.max(0, Math.min(100, Math.round((weighted / ctx.weightSum) * 100)));
};

export const annotatePropertyScoresByContext = (property, ctx) => {
  const score = scorePropertyByContext(property, ctx, 'relaxed');
  const strictScore = scorePropertyByContext(property, ctx, 'strict');
  return {
    ...property,
    score,
    strictScore,
    matchTier: resolveTierByScore(score),
    _score: score,
    _strictScore: strictScore,
    _tier: resolveTierByScore(score)
  };
};

