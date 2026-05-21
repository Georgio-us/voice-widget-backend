import { listResidentialComplexes } from './residentialComplexesRepository.js';
import {
  expandResidentialComplexInput,
  residentialComplexInputToArray
} from './residentialComplexMatcher.js';

export const applyResidentialComplexFallbackFromTranscript = (transcription = '', insights = {}) => {
  const source = String(transcription || '').trim();
  if (!source || !insights || typeof insights !== 'object') {
    return { applied: false, rcOnly: false, complex: null };
  }
  let applied = false;
  let rcOnlyApplied = false;
  let complexApplied = null;

  const lower = source.toLowerCase();
  const rcOnlyRe = /(?:^|\s)(?:[жз]к|[жз]\/к)(?:\s|$)|(?:только|лишь|исключительно)\s+(?:в\s+)?(?:[жз]к|[жз]\/к|жил(?:ой|ого|ому|ом|ые|ых|ыми|ая|ую)?\s+комплекс(?:ы|а|у|е|ом|ах|ами|ов)?)|\bв\s*[жз]к\b|\bжил(?:ой|ого|ому|ом|ые|ых|ыми|ая|ую)?\s+комплекс(?:ы|а|у|е|ом|ах|ами|ов)?\b|\bв\s+жил(?:ом|ых|ой)\s+комплекс(?:е|ах|ов)?\b/i;
  const hasRcOnly = rcOnlyRe.test(lower);
  if (hasRcOnly && insights.rcOnly !== true) {
    insights.rcOnly = true;
    insights.residentialComplexOnly = true;
    applied = true;
    rcOnlyApplied = true;
  }

  if (residentialComplexInputToArray(insights.residentialComplex).length === 0) {
    const cleanupComplexCandidate = (value) => {
      let text = String(value || '').trim();
      if (!text) return '';
      text = text
        .replace(/\s+(?:в|на|для|до|по|из|у|к|рядом|возле|около|near)\b.*$/i, '')
        .replace(/\s+(?:район|мікрорайон|микрорайон|district|area)\b.*$/i, '')
        .replace(/\s+\d{1,3}(?:[.,]\d+)?\s*(?:usd|\$|доллар|долл|грн|₴)\b.*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[«"'`]+|[»"'`]+$/g, '')
        .trim();
      return text;
    };
    let complexName = null;
    const quoted = source.match(/\b(?:жк|зк|жил(?:ой|ого|ому|ом|ые|ых|ыми|ая|ую)?\s+комплекс(?:ы|а|у|е|ом|ах|ами|ов)?)\s*[«"']([^»"']{2,40})[»"']/i);
    if (quoted && quoted[1]) {
      complexName = String(quoted[1]).trim();
    } else {
      const plain = source.match(/\b(?:жк|зк|жил(?:ой|ого|ому|ом|ые|ых|ыми|ая|ую)?\s+комплекс(?:ы|а|у|е|ом|ах|ами|ов)?)\s+([a-zа-яё0-9][a-zа-яё0-9\-]{1,20}(?:\s+[a-zа-яё0-9\-]{1,20}){0,2})(?=$|[,.!?;:]|\s+(?:в|на|для|до|котор|где|возле|рядом|около|у|из|по)\b)/i);
      if (plain && plain[1]) {
        complexName = String(plain[1]).trim();
      }
    }
    if (complexName) {
      const cleaned = cleanupComplexCandidate(complexName);
      if (cleaned.length >= 2) {
        insights.residentialComplex = cleaned;
        applied = true;
        complexApplied = cleaned;
      }
    }
  }

  return { applied, rcOnly: rcOnlyApplied, complex: complexApplied };
};

export const validateResidentialComplexInsights = async ({
  clientId,
  insights,
  limit = 1000,
  logger = console
} = {}) => {
  if (!insights || typeof insights !== 'object') {
    return { checked: false, matched: [], requested: [] };
  }

  const rcs = await listResidentialComplexes(clientId, { limit });
  if (!rcs || rcs.length === 0) {
    return { checked: true, matched: [], requested: [] };
  }

  const rcExpansion = expandResidentialComplexInput(insights.residentialComplex, rcs);
  if (rcExpansion.matched.length > 0) {
    insights.residentialComplex = rcExpansion.matched.length === 1
      ? rcExpansion.matched[0]
      : rcExpansion.matched;
    insights.residentialComplexOnly = true;
    insights.rcOnly = true;
    if (rcExpansion.matched.length > 1) {
      logger?.log?.(`[RC_VALIDATOR] Expanded RC "${rcExpansion.requested.join(', ')}" -> ${rcExpansion.matched.join(' | ')}`);
    }
  } else if (rcExpansion.requested.length > 0) {
    logger?.warn?.(`[RC_VALIDATOR] Rejected unknown RC: "${rcExpansion.requested.join(', ')}". Forcing rcOnly=true.`);
    insights.residentialComplex = null;
    insights.residentialComplexOnly = true;
    insights.rcOnly = true;
  }

  return {
    checked: true,
    matched: rcExpansion.matched,
    requested: rcExpansion.requested
  };
};
