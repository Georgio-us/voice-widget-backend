import { formatCardForClient } from './audioCardFormatter.js';
import {
  clip,
  getDeployShortOrNull,
  getLatestMatchRuleId,
  normalizeForClientDebug
} from './audioDebugUtils.js';
import { buildLlmContextPack } from './llmContextPack.js';

export const buildAudioResponsePayload = ({
  req,
  session,
  sessionId,
  botResponse,
  transcription,
  inputType,
  inputTypeForLog,
  extractionReport,
  extractionInvalidFields,
  demoCatalogContext,
  demoPromptFlavorContext,
  totalMatches,
  strictMatches,
  relaxedMatches,
  ranked,
  cards,
  ui,
  disableServerUi,
  promptTokens,
  completionTokens,
  totalTokens,
  transcriptionTime,
  gptTime,
  totalTime,
  isSuperAdminViewer,
  clientDebugEnabled,
  llmContextPackForMainCall,
  bindHas,
  bindCardId,
  spoke,
  mismatchBindVsSpoke
}) => {
  const responsePayload = {
    response: botResponse,
    transcription,
    sessionId,
    messageCount: session.messages.length,
    inputType,
    clientProfile: session.clientProfile,
    stage: session.stage,
    role: session.role,
    insights: session.insights,
    extractionStatus: {
      metaPresent: extractionReport.metaPresent === true,
      parseError: extractionReport.parseError === true,
      validationError: extractionReport.validationError === true,
      updatesApplied: extractionReport.updatesApplied === true,
      fallbackUsed: extractionReport.fallbackUsed === true,
      invalidFields: extractionInvalidFields,
      demoCatalogContext: demoCatalogContext?.meta || null,
      demoPromptFlavor: demoPromptFlavorContext?.meta || null
    },
    totalMatches,
    strictMatches,
    relaxedMatches,
    topCandidates: ranked.slice(0, 20).map((p) => formatCardForClient(req, p)),
    cards: disableServerUi ? [] : cards,
    ui: disableServerUi ? undefined : ui,
    tokens: {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens
    },
    timing: {
      transcription: transcriptionTime,
      gpt: gptTime,
      total: totalTime
    }
  };

  if (!isSuperAdminViewer) {
    delete responsePayload.extractionStatus;
    delete responsePayload.topCandidates;
    delete responsePayload.tokens;
    delete responsePayload.timing;
  }

  if (clientDebugEnabled === true && isSuperAdminViewer) {
    const matchRuleId = getLatestMatchRuleId(session);
    const pack = llmContextPackForMainCall || buildLlmContextPack(session, sessionId, 'main');
    const factsIds = Array.isArray(pack?.facts?.factsCardIds) ? pack.facts.factsCardIds.filter(Boolean) : [];
    const allowedFactsSnapshot = pack?.facts?.allowedFactsSnapshot ?? null;
    const allowedFacts = (allowedFactsSnapshot && typeof allowedFactsSnapshot === 'object' && Object.keys(allowedFactsSnapshot).length > 0) ? 1 : 0;

    responsePayload.debug = {
      deploy: getDeployShortOrNull(),
      sid: String(sessionId || '').slice(-8) || 'unknown',
      ts: Date.now(),
      input: {
        type: inputTypeForLog,
        raw: clip(transcription, 80),
        norm: clip(normalizeForClientDebug(transcription), 80)
      },
      ref: {
        type: session.referenceIntent?.type ?? null,
        rule: matchRuleId
      },
      ui: {
        focus: session.currentFocusCard?.cardId || null,
        lastShown: session.lastShown?.cardId || null,
        lastFocus: session.lastFocusSnapshot?.cardId || null,
        slider: session.sliderContext?.active === true ? 1 : 0
      },
      bind: {
        has: bindHas ? 1 : 0,
        cardId: bindCardId,
        basis: session.singleReferenceBinding?.basis ?? null
      },
      facts: {
        ids: factsIds,
        allowed: allowedFacts,
        count: factsIds.length
      },
      spoke: {
        cardId: spoke.cardId,
        confidence: spoke.confidence
      },
      mismatch: {
        bindVsSpoke: mismatchBindVsSpoke
      }
    };
  }

  return responsePayload;
};
