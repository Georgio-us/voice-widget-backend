export const INSIGHT_FIELDS = [
  'name', 'operation', 'budget', 'budgetMax', 'type', 'district', 'location', 'rooms',
  'area', 'areaMin', 'areaMax', 'floor', 'features', 'details', 'preferences',
  'residentialComplex', 'floorNotFirst', 'floorNotLast'
];

export const mergeClientProfile = (current, delta) => {
  const result = { ...(current || {}) };
  if (delta && typeof delta === 'object') {
    for (const [key, value] of Object.entries(delta)) {
      if (value !== undefined && value !== null) {
        result[key] = value;
      }
    }
  }
  return result;
};

export const normalizeNumber = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

const formatNumberUS = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric).toLocaleString('en-US');
};

export const formatBudgetFromRange = (min, max) => {
  const minNum = normalizeNumber(min);
  const maxNum = normalizeNumber(max);
  const minFormatted = formatNumberUS(minNum);
  const maxFormatted = formatNumberUS(maxNum);
  if (minFormatted && maxFormatted) return `${minFormatted}–${maxFormatted} USD`;
  if (!minFormatted && maxFormatted) return `до ${maxFormatted} USD`;
  if (minFormatted && !maxFormatted) return `от ${minFormatted} USD`;
  return null;
};

export const recalcInsightsProgress = (insights) => {
  if (!insights || typeof insights !== 'object') return;
  const weights = {
    name: 7,
    operation: 7,
    budget: 7,
    budgetMax: 7,
    type: 7,
    district: 7,
    location: 7,
    rooms: 7,
    area: 7,
    areaMin: 7,
    areaMax: 7,
    floor: 7,
    features: 7,
    details: 7,
    preferences: 7,
    residentialComplex: 7,
    floorNotFirst: 7,
    floorNotLast: 7
  };
  let totalProgress = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const val = insights[field];
    if (val != null && String(val).trim()) totalProgress += weight;
  }
  insights.progress = Math.min(totalProgress, 99);
};

export const sanitizeInsightValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const cleaned = value.map((item) => String(item ?? '').trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(', ') : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('value' in value) return sanitizeInsightValue(value.value);
    try {
      const packed = JSON.stringify(value);
      return packed && packed !== '{}' ? packed : null;
    } catch {
      return null;
    }
  }
  return null;
};

export const mapPurposeToOperationRu = (purpose) => {
  if (!purpose) return null;
  const s = String(purpose).toLowerCase();
  if (/(buy|покуп|купить|purchase|invest|инвест)/i.test(s)) return 'покупка';
  if (/(rent|аренд|оренд|снять|lease)/i.test(s)) return 'аренда';
  return null;
};

export const mapClientProfileToInsights = (clientProfile, insights) => {
  if (!clientProfile || !insights) return;
  const explicitBudget = sanitizeInsightValue(clientProfile.budget);
  const budgetStr = explicitBudget || formatBudgetFromRange(clientProfile.budgetMin, clientProfile.budgetMax);
  if (budgetStr) insights.budget = budgetStr;
  if (clientProfile.budgetMax != null) insights.budgetMax = clientProfile.budgetMax;

  const location = sanitizeInsightValue(clientProfile.location);
  if (location) insights.location = location;

  const propertyType = sanitizeInsightValue(clientProfile.propertyType);
  if (propertyType) insights.type = propertyType;

  const op = mapPurposeToOperationRu(clientProfile.purpose);
  if (op) insights.operation = op;
  const operation = sanitizeInsightValue(clientProfile.operation);
  if (operation) insights.operation = operation;

  if (clientProfile.urgency && /сроч/i.test(String(clientProfile.urgency))) {
    insights.preferences = 'срочный поиск';
  }

  for (const [profileKey, insightKey] of [
    ['name', 'name'],
    ['rooms', 'rooms'],
    ['area', 'area'],
    ['floor', 'floor'],
    ['details', 'details'],
    ['preferences', 'preferences']
  ]) {
    const val = sanitizeInsightValue(clientProfile[profileKey]);
    if (val) insights[insightKey] = val;
  }
  recalcInsightsProgress(insights);
};
