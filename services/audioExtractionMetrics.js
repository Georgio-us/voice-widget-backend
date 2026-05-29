import { INSIGHT_FIELDS } from './insightsProfilePolicy.js';

export const ensureExtractionMetrics = (session) => {
  if (!session.extractionMetrics || typeof session.extractionMetrics !== 'object') {
    session.extractionMetrics = {};
  }
  const m = session.extractionMetrics;
  m.turnsTotal = Number(m.turnsTotal || 0);
  m.metaPresentTurns = Number(m.metaPresentTurns || 0);
  m.parseErrors = Number(m.parseErrors || 0);
  m.validationErrors = Number(m.validationErrors || 0);
  m.updatesApplied = Number(m.updatesApplied || 0);
  if (!m.fieldFilledTurns || typeof m.fieldFilledTurns !== 'object') {
    m.fieldFilledTurns = {};
  }
  for (const f of INSIGHT_FIELDS) {
    m.fieldFilledTurns[f] = Number(m.fieldFilledTurns[f] || 0);
  }
  return m;
};

export const updateExtractionMetrics = (session, report = {}) => {
  if (!session) return;
  const m = ensureExtractionMetrics(session);
  m.turnsTotal += 1;
  if (report.metaPresent === true) m.metaPresentTurns += 1;
  if (report.parseError === true) m.parseErrors += 1;
  if (report.validationError === true) m.validationErrors += 1;
  if (report.updatesApplied === true) m.updatesApplied += 1;
  for (const f of INSIGHT_FIELDS) {
    const v = session.insights?.[f];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      m.fieldFilledTurns[f] += 1;
    }
  }
  const turns = Math.max(1, m.turnsTotal);
  const fillRates = {};
  for (const f of INSIGHT_FIELDS) {
    fillRates[f] = Number((m.fieldFilledTurns[f] / turns).toFixed(3));
  }
  const parseErrorRate = Number((m.parseErrors / turns).toFixed(3));
  console.log('[INSIGHTS_METRICS]', {
    turnsTotal: m.turnsTotal,
    parseErrorRate,
    updatesApplied: m.updatesApplied,
    fillRates
  });
};
