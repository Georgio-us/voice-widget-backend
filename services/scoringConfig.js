export const SCORE_WEIGHTS = Object.freeze({
  rooms: 34,
  budget: 20,
  area: 10,
  floor: 10,
  parking: 13,
  balcony: 13
});

export const SCORE_BANDS = Object.freeze({
  preferred: 0.10,
  acceptable: 0.25
});

export const SCORE_TIER_THRESHOLDS = Object.freeze({
  high: 80,
  mid: 50
});

// Feature behavior contract:
// - when selected by user: match gives full bonus, miss gives no bonus
// - when not selected by user: feature weight is excluded from score
export const FEATURE_SCORE_RULES = Object.freeze({
  selectedMatch: 1,
  selectedNoMatch: 0
});

export const resolveTierByScore = (score) => {
  const safe = Number(score) || 0;
  if (safe >= SCORE_TIER_THRESHOLDS.high) return 'high';
  if (safe >= SCORE_TIER_THRESHOLDS.mid) return 'mid';
  return 'low';
};
