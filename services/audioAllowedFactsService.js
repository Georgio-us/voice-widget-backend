export const ALLOWED_FACTS_SCHEMA = [
  'cardId',
  'city',
  'district',
  'neighborhood',
  'priceEUR',
  'rooms',
  'floor',
  'hasImage'
];

export const buildAllowedFactsSnapshot = (cardData, variantId) => {
  if (!cardData) return null;
  const snapshot = {};

  ALLOWED_FACTS_SCHEMA.forEach((field) => {
    if (field === 'cardId') {
      snapshot.cardId = variantId;
    } else if (field === 'hasImage') {
      snapshot.hasImage = !!(cardData.images && Array.isArray(cardData.images) && cardData.images.length > 0);
    } else {
      snapshot[field] = cardData[field] || null;
    }
  });

  return snapshot;
};
