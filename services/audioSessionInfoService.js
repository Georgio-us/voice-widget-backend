import { formatCardForClient } from './audioCardFormatter.js';
import { getRankedProperties } from './audioPropertySearchService.js';

export const buildAudioStatsPayload = (sessions) => {
  const sessionStats = [];

  sessions.forEach((session, sessionId) => {
    sessionStats.push({
      sessionId,
      messageCount: session.messages.length,
      lastActivity: session.lastActivity,
      insights: session.insights
    });
  });

  return {
    totalSessions: sessions.size,
    sessions: sessionStats
  };
};

export const buildAudioSessionInfoPayload = async ({ req, sessionId, session, verbose = false }) => {
  const { totalMatches, strictMatches, relaxedMatches, ranked } = await getRankedProperties(session.insights || {});
  const basePayload = {
    sessionId,
    clientProfile: session.clientProfile,
    stage: session.stage,
    role: session.role,
    insights: session.insights,
    totalMatches,
    strictMatches,
    relaxedMatches,
    topCandidates: ranked.slice(0, 24).map((p) => formatCardForClient(req, p)),
    lastCandidates: Array.isArray(session.lastCandidates) ? session.lastCandidates.slice(0, 80) : [],
    messageCount: session.messages.length,
    lastActivity: session.lastActivity,
    currentFocusCard: session.currentFocusCard || { cardId: null, updatedAt: null },
    lastShown: session.lastShown || { cardId: null, updatedAt: null },
    lastFocusSnapshot: session.lastFocusSnapshot || null,
    debugSummary: {
      candidateShortlistCount: Array.isArray(session?.candidateShortlist?.items) ? session.candidateShortlist.items.length : 0,
      unknownUiActionsCount: Number(session?.unknownUiActions?.count || 0),
      debugTraceCount: Array.isArray(session?.debugTrace?.items) ? session.debugTrace.items.length : 0
    }
  };

  if (!verbose) return basePayload;

  return {
    ...basePayload,
    referenceIntent: session.referenceIntent || null,
    referenceAmbiguity: session.referenceAmbiguity || { isAmbiguous: false, reason: null, detectedAt: null, source: 'server_contract' },
    clarificationRequired: session.clarificationRequired || { isRequired: false, reason: null, detectedAt: null, source: 'server_contract' },
    singleReferenceBinding: session.singleReferenceBinding || { hasProposal: false, proposedCardId: null, source: 'server_contract', detectedAt: null, basis: null },
    clarificationBoundaryActive: session.clarificationBoundaryActive || false,
    candidateShortlist: session.candidateShortlist || { items: [] },
    explicitChoiceEvent: session.explicitChoiceEvent || { isConfirmed: false, cardId: null, detectedAt: null, source: 'user_message' },
    choiceConfirmationBoundary: session.choiceConfirmationBoundary || { active: false, chosenCardId: null, detectedAt: null, source: null },
    noGuessingInvariant: session.noGuessingInvariant || { active: false, reason: null, enforcedAt: null },
    unknownUiActions: session.unknownUiActions || { count: 0, items: [] },
    debugTrace: session.debugTrace || { items: [] }
  };
};
