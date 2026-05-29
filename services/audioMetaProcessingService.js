import { mapClientProfileToInsights, mergeClientProfile } from './insightsProfilePolicy.js';
import { applyResidentialComplexFallbackFromTranscript, validateResidentialComplexInsights } from './residentialComplexPolicy.js';
import { applyMetaInsightsToSession } from './audioMetaInsightsApplier.js';
import { updateExtractionMetrics } from './audioExtractionMetrics.js';

export const processStructuredMeta = async ({
  session,
  sessionId,
  meta,
  metaRaw,
  parseError,
  fallbackUsed,
  transcription,
  clientId = process.env.CLIENT_ID || 'georgio-us',
  logger = console
} = {}) => {
  const extractionReport = {
    metaPresent: !!metaRaw,
    parseError: parseError === true,
    validationError: false,
    updatesApplied: false,
    fallbackUsed: fallbackUsed === true
  };
  let extractionInvalidFields = [];

  try {
    if (meta && typeof meta === 'object') {
      const profilePatches = [];
      if (meta.clientProfileDelta && typeof meta.clientProfileDelta === 'object') profilePatches.push(meta.clientProfileDelta);
      if (meta.clientProfile && typeof meta.clientProfile === 'object') profilePatches.push(meta.clientProfile);
      for (const patch of profilePatches) {
        session.clientProfile = mergeClientProfile(session.clientProfile, patch);
      }
      mapClientProfileToInsights(session.clientProfile, session.insights);
      const applyResult = applyMetaInsightsToSession(session, meta, transcription);
      extractionInvalidFields = Array.isArray(applyResult?.invalidFields) ? applyResult.invalidFields : [];
      extractionReport.validationError = Array.isArray(applyResult?.invalidFields) && applyResult.invalidFields.length > 0;
      extractionReport.updatesApplied = applyResult?.applied === true;
      session.metaContract = {
        ...(session.metaContract || {}),
        needsRepairHint: extractionReport.parseError || extractionReport.validationError,
        lastError: extractionReport.parseError ? 'meta_parse_error' : (extractionReport.validationError ? 'meta_validation_error' : null),
        lastMetaRaw: metaRaw || null,
        lastUpdatedAt: new Date().toISOString()
      };
      const profileLog = {
        language: session.clientProfile.language,
        location: session.clientProfile.location,
        budgetMin: session.clientProfile.budgetMin,
        budgetMax: session.clientProfile.budgetMax,
        purpose: session.clientProfile.purpose,
        propertyType: session.clientProfile.propertyType,
        urgency: session.clientProfile.urgency
      };
      logger?.log?.(`🧩 Профиль/инсайты обновлены [${String(sessionId).slice(-8)}]: ${JSON.stringify(profileLog)}`);
    } else {
      session.metaContract = {
        ...(session.metaContract || {}),
        needsRepairHint: true,
        lastError: extractionReport.parseError ? 'meta_parse_error' : 'meta_missing',
        lastMetaRaw: metaRaw || null,
        lastUpdatedAt: new Date().toISOString()
      };
    }
  } catch {
    logger?.log?.('ℹ️ META отсутствует или невалидна, продолжаем без обновления профиля');
    extractionReport.validationError = true;
    session.metaContract = {
      ...(session.metaContract || {}),
      needsRepairHint: true,
      lastError: 'meta_processing_exception',
      lastMetaRaw: metaRaw || null,
      lastUpdatedAt: new Date().toISOString()
    };
  }

  const rcFallback = applyResidentialComplexFallbackFromTranscript(transcription, session.insights);

  try {
    await validateResidentialComplexInsights({
      clientId,
      insights: session.insights,
      limit: 1000,
      logger
    });
  } catch (error) {
    logger?.error?.('[RC_VALIDATOR] Failed to validate RC against catalog:', error);
  }

  if (rcFallback.applied) {
    extractionReport.fallbackUsed = true;
    extractionReport.updatesApplied = true;
    try {
      logger?.log?.(`[RC_FALLBACK] sid=${String(sessionId || '').slice(-8) || 'unknown'} rcOnly=${rcFallback.rcOnly ? 1 : 0} complex=${rcFallback.complex || 'null'}`);
    } catch {}
  }

  updateExtractionMetrics(session, extractionReport);

  return {
    extractionReport,
    extractionInvalidFields,
    rcFallback
  };
};
