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

export const resolveTierByScore = (score) => {
  const safe = Number(score) || 0;
  if (safe >= 80) return 'high';
  if (safe >= 50) return 'mid';
  return 'low';
};
