import { detectExplicitChoiceMarker } from './chatIntentPolicy.js';
import {
  REF_FALLBACK_CONFIDENCE_THRESHOLD,
  classifyReferenceIntentFallbackLLM,
  detectReferenceIntent,
  shouldUseReferenceFallback
} from './audioReferenceIntentService.js';
import { callOpenAIWithRetry } from './openAiRetryService.js';

const ensureDebugTrace = (session) => {
  if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
    session.debugTrace = { items: [] };
  }
};

const normalizeReferenceSnippet = (text) => (
  text
    ? String(text)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-z0-9а-я\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
    : ''
);

const escapeLogValue = (value) => (
  String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
);

export const createReferenceFallbackSummary = () => ({
  gateChecked: false,
  gateEligible: false,
  gateBlockedByBoundary: false,
  called: false,
  outputType: null,
  confidence: 0,
  threshold: REF_FALLBACK_CONFIDENCE_THRESHOLD,
  decision: 'not_called',
  finalEffect: null,
  clampApplied: false
});

export const runAudioReferencePipeline = async ({
  session,
  sessionId,
  transcription,
  inputTypeForLog,
  openai
}) => {
  const refFallbackSummary = createReferenceFallbackSummary();
  const shortSid = sessionId ? sessionId.slice(-8) : 'unknown';

  const refDetectResult = detectReferenceIntent(transcription);
  session.referenceIntent = refDetectResult ? {
    type: refDetectResult.type,
    detectedAt: refDetectResult.detectedAt,
    source: refDetectResult.source
  } : null;

  ensureDebugTrace(session);
  const rawSnippet = transcription ? transcription.slice(0, 40) : '';
  const normalizedForTrace = normalizeReferenceSnippet(transcription);
  session.debugTrace.items.push({
    type: 'reference_detected',
    at: Date.now(),
    payload: {
      referenceType: refDetectResult?.type || null,
      matchRuleId: refDetectResult?.matchRuleId || null,
      rawTextSnippet: rawSnippet,
      normalizedTextSnippet: normalizedForTrace,
      inputType: inputTypeForLog,
      language: session.clientProfile?.language || null
    }
  });

  const focusCardId = session.currentFocusCard?.cardId || null;
  const ambiguousFlag = session.referenceAmbiguity?.isAmbiguous === true;
  const clarificationActive = session.clarificationBoundaryActive === true;
  console.log(`[REF] sid=${shortSid} input=${inputTypeForLog} lang=${session.clientProfile?.language || 'null'} raw="${rawSnippet}" norm="${normalizedForTrace}" intent=${refDetectResult?.type || 'null'} rule=${refDetectResult?.matchRuleId || 'null'} amb=${ambiguousFlag} clar=${clarificationActive} focus=${focusCardId}`);

  let fallbackAppliedForPipeline = false;
  let fallbackAppliedReferenceType = null;

  if (session.referenceIntent == null) {
    refFallbackSummary.gateChecked = true;
    refFallbackSummary.gateBlockedByBoundary =
      session?.referenceAmbiguity?.isAmbiguous === true ||
      session?.clarificationRequired?.isRequired === true ||
      session?.clarificationBoundaryActive === true;

    const gateEligible = shouldUseReferenceFallback(session, transcription) === true;
    refFallbackSummary.gateEligible = gateEligible;

    if (gateEligible === true) {
      const lang = session.clientProfile?.language || null;
      refFallbackSummary.called = true;

      const out = await classifyReferenceIntentFallbackLLM({
        openai,
        text: transcription,
        language: lang,
        retryOpenAI: (fn) => callOpenAIWithRetry(fn, 2, 'REF-Fallback-Classifier')
      });

      const thr = REF_FALLBACK_CONFIDENCE_THRESHOLD;
      const referenceType = out?.referenceType ?? null;
      const confidence = (typeof out?.confidence === 'number' && Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1)
        ? out.confidence
        : 0;
      const reasonTag = out?.reasonTag ?? null;
      const isValidType = referenceType === 'single' || referenceType === 'multi' || referenceType === 'unknown';
      const isConfident = isValidType && confidence >= thr;
      const decision = isValidType
        ? (isConfident ? 'applied' : 'ignored_low_confidence')
        : 'ignored_invalid_output';

      refFallbackSummary.outputType = referenceType;
      refFallbackSummary.confidence = confidence;
      refFallbackSummary.threshold = thr;
      refFallbackSummary.decision = decision;

      if (decision === 'applied') {
        session.referenceIntent = {
          type: referenceType,
          detectedAt: Date.now(),
          source: 'fallback_llm'
        };
        fallbackAppliedForPipeline = true;
        fallbackAppliedReferenceType = referenceType;
      }

      ensureDebugTrace(session);
      session.debugTrace.items.push({
        type: 'reference_fallback',
        at: Date.now(),
        payload: {
          rawTextSnippet: rawSnippet,
          normalizedTextSnippet: normalizedForTrace,
          language: lang,
          gateEligible: true,
          decision,
          threshold: thr,
          confidence,
          referenceType,
          reasonTag: reasonTag ?? null,
          output: {
            referenceType,
            confidence,
            reasonTag: reasonTag ?? null
          }
        }
      });

      console.log(`[REF_FALLBACK] sid=${shortSid} lang=${lang || 'null'} raw="${escapeLogValue(rawSnippet)}" norm="${escapeLogValue(normalizedForTrace)}" out=${referenceType || 'null'} conf=${confidence} thr=${thr} decision=${decision} reason=${reasonTag || 'null'}`);
    } else {
      refFallbackSummary.decision = 'not_called';
    }
  }

  if (!session.referenceAmbiguity) {
    session.referenceAmbiguity = {
      isAmbiguous: false,
      reason: null,
      detectedAt: null,
      source: 'server_contract'
    };
  }

  if (session.referenceIntent === null) {
    session.referenceAmbiguity.isAmbiguous = false;
    session.referenceAmbiguity.reason = null;
    session.referenceAmbiguity.detectedAt = null;
  } else if (session.referenceIntent.type === 'multi') {
    session.referenceAmbiguity.isAmbiguous = true;
    session.referenceAmbiguity.reason = 'multi_reference';
    session.referenceAmbiguity.detectedAt = Date.now();
  } else if (session.referenceIntent.type === 'unknown') {
    session.referenceAmbiguity.isAmbiguous = true;
    session.referenceAmbiguity.reason = 'unknown_reference';
    session.referenceAmbiguity.detectedAt = Date.now();
  } else if (session.referenceIntent.type === 'single') {
    session.referenceAmbiguity.isAmbiguous = false;
    session.referenceAmbiguity.reason = null;
    session.referenceAmbiguity.detectedAt = null;
  }

  if (!session.clarificationRequired) {
    session.clarificationRequired = {
      isRequired: false,
      reason: null,
      detectedAt: null,
      source: 'server_contract'
    };
  }

  if (session.referenceAmbiguity.isAmbiguous === true) {
    session.clarificationRequired.isRequired = true;
    session.clarificationRequired.reason = session.referenceAmbiguity.reason;
    session.clarificationRequired.detectedAt = Date.now();
  } else {
    session.clarificationRequired.isRequired = false;
    session.clarificationRequired.reason = null;
    session.clarificationRequired.detectedAt = null;
  }

  if (!session.singleReferenceBinding) {
    session.singleReferenceBinding = {
      hasProposal: false,
      proposedCardId: null,
      source: 'server_contract',
      detectedAt: null,
      basis: null
    };
  }

  if (
    session.referenceIntent?.type === 'single' &&
    session.clarificationRequired.isRequired === false &&
    session.currentFocusCard?.cardId
  ) {
    session.singleReferenceBinding.hasProposal = true;
    session.singleReferenceBinding.proposedCardId = session.currentFocusCard.cardId;
    session.singleReferenceBinding.basis = 'currentFocusCard';
    session.singleReferenceBinding.detectedAt = Date.now();
  } else {
    session.singleReferenceBinding.hasProposal = false;
    session.singleReferenceBinding.proposedCardId = null;
    session.singleReferenceBinding.basis = null;
    session.singleReferenceBinding.detectedAt = null;
  }

  const prevClarificationBoundaryActive = session.clarificationBoundaryActive === true;
  session.clarificationBoundaryActive = session.clarificationRequired.isRequired === true;
  if (prevClarificationBoundaryActive !== true && session.clarificationBoundaryActive === true) {
    ensureDebugTrace(session);
    session.debugTrace.items.push({
      type: 'clarification_boundary',
      at: Date.now(),
      payload: { reason: session.clarificationRequired?.reason || null }
    });
  }

  if (!session.noGuessingInvariant) {
    session.noGuessingInvariant = { active: false, reason: null, enforcedAt: null };
  }
  if (session.clarificationBoundaryActive === true) {
    session.noGuessingInvariant.active = true;
    session.noGuessingInvariant.reason = 'clarification_required';
    session.noGuessingInvariant.enforcedAt = Date.now();
  } else {
    session.noGuessingInvariant.active = false;
    session.noGuessingInvariant.reason = null;
    session.noGuessingInvariant.enforcedAt = null;
  }

  if (session.noGuessingInvariant.active === true && session.singleReferenceBinding) {
    session.singleReferenceBinding.hasProposal = false;
    session.singleReferenceBinding.proposedCardId = null;
  }

  if (!session.candidateShortlist || !Array.isArray(session.candidateShortlist.items)) {
    session.candidateShortlist = { items: [] };
  }

  const proposedCardIdForShortlist = session.singleReferenceBinding?.hasProposal === true
    ? session.singleReferenceBinding?.proposedCardId
    : null;

  if (session.clarificationBoundaryActive === false && proposedCardIdForShortlist) {
    const alreadyAdded = session.candidateShortlist.items.some(it => it && it.cardId === proposedCardIdForShortlist);
    if (!alreadyAdded) {
      session.candidateShortlist.items.push({
        cardId: proposedCardIdForShortlist,
        source: 'focus_proposal',
        detectedAt: Date.now()
      });
    }
  }

  if (!session.explicitChoiceEvent) {
    session.explicitChoiceEvent = { isConfirmed: false, cardId: null, detectedAt: null, source: 'user_message' };
  }
  if (session.explicitChoiceEvent.isConfirmed !== true) {
    const eligibleForExplicitChoice =
      session.clarificationBoundaryActive === false &&
      session.singleReferenceBinding?.hasProposal === true &&
      Boolean(session.singleReferenceBinding?.proposedCardId);

    if (eligibleForExplicitChoice && detectExplicitChoiceMarker(transcription)) {
      session.explicitChoiceEvent.isConfirmed = true;
      session.explicitChoiceEvent.cardId = session.singleReferenceBinding.proposedCardId;
      session.explicitChoiceEvent.detectedAt = Date.now();
      session.explicitChoiceEvent.source = 'user_message';
      ensureDebugTrace(session);
      session.debugTrace.items.push({
        type: 'explicit_choice',
        at: Date.now(),
        payload: { cardId: session.explicitChoiceEvent.cardId || null }
      });
    }
  }

  if (
    session.explicitChoiceEvent?.isConfirmed === true &&
    Boolean(session.explicitChoiceEvent?.cardId) === true &&
    session.noGuessingInvariant?.active !== true
  ) {
    const alreadyAddedExplicitChoice = session.candidateShortlist?.items?.some(
      (it) => it && it.cardId === session.explicitChoiceEvent.cardId && it.source === 'explicit_choice_event'
    );
    if (!alreadyAddedExplicitChoice) {
      session.candidateShortlist.items.push({
        cardId: session.explicitChoiceEvent.cardId,
        source: 'explicit_choice_event',
        detectedAt: session.explicitChoiceEvent.detectedAt || Date.now()
      });
    }
  }

  if (!session.choiceConfirmationBoundary) {
    session.choiceConfirmationBoundary = { active: false, chosenCardId: null, detectedAt: null, source: null };
  }
  if (
    session.choiceConfirmationBoundary.active !== true &&
    session.explicitChoiceEvent?.isConfirmed === true &&
    Boolean(session.explicitChoiceEvent?.cardId) &&
    session.noGuessingInvariant?.active !== true
  ) {
    session.choiceConfirmationBoundary.active = true;
    session.choiceConfirmationBoundary.chosenCardId = session.explicitChoiceEvent.cardId || null;
    session.choiceConfirmationBoundary.detectedAt = session.explicitChoiceEvent.detectedAt || null;
    session.choiceConfirmationBoundary.source = 'explicit_choice_event';
    ensureDebugTrace(session);
    session.debugTrace.items.push({
      type: 'choice_boundary',
      at: Date.now(),
      payload: { cardId: session.choiceConfirmationBoundary.chosenCardId || null }
    });
  }

  if (fallbackAppliedForPipeline === true) {
    const amb = session.referenceAmbiguity?.isAmbiguous === true;
    const clarReq = session.clarificationRequired?.isRequired === true;
    const clarBoundary = session.clarificationBoundaryActive === true;
    const hasProposalBeforeClamp = session.singleReferenceBinding?.hasProposal === true;
    const finalEffect = (amb === true || clarReq === true || clarBoundary === true)
      ? 'clarification'
      : (hasProposalBeforeClamp === true ? 'binding' : 'clarification');

    const clampApplied = finalEffect === 'clarification';
    if (clampApplied === true) {
      if (session.singleReferenceBinding) {
        session.singleReferenceBinding.hasProposal = false;
        session.singleReferenceBinding.proposedCardId = null;
      }
      if (session.explicitChoiceEvent) {
        session.explicitChoiceEvent.isConfirmed = false;
        if ('cardId' in session.explicitChoiceEvent) {
          session.explicitChoiceEvent.cardId = null;
        }
      }
      if (session.choiceConfirmationBoundary) {
        session.choiceConfirmationBoundary.active = false;
        if ('chosenCardId' in session.choiceConfirmationBoundary) {
          session.choiceConfirmationBoundary.chosenCardId = null;
        }
      }
    }

    const hasProposal = session.singleReferenceBinding?.hasProposal === true;
    const proposedCardId = session.singleReferenceBinding?.proposedCardId || null;
    ensureDebugTrace(session);
    session.debugTrace.items.push({
      type: 'reference_pipeline_after_fallback',
      at: Date.now(),
      payload: {
        decision: 'applied',
        referenceType: fallbackAppliedReferenceType || null,
        ambiguous: amb,
        clarificationRequired: clarReq,
        clarificationBoundaryActive: clarBoundary,
        hasProposal,
        proposedCardId,
        finalEffect,
        clampApplied
      }
    });
    console.log(`[REF_FALLBACK_PIPELINE] sid=${shortSid} ref=${fallbackAppliedReferenceType || 'null'} amb=${amb ? 1 : 0} clarReq=${clarReq ? 1 : 0} clarBoundary=${clarBoundary ? 1 : 0} bind=${hasProposal ? 1 : 0} bindCard=${proposedCardId || 'null'} finalEffect=${finalEffect} clamp=${clampApplied ? 1 : 0}`);

    refFallbackSummary.finalEffect = finalEffect;
    refFallbackSummary.clampApplied = clampApplied === true;
  }

  return { refFallbackSummary };
};

export const logReferenceFallbackSummary = ({ session, sessionId, refFallbackSummary }) => {
  if (!(refFallbackSummary?.gateChecked === true || refFallbackSummary?.called === true)) {
    return;
  }

  ensureDebugTrace(session);
  session.debugTrace.items.push({
    type: 'reference_fallback_summary',
    at: Date.now(),
    payload: {
      gateChecked: refFallbackSummary.gateChecked === true,
      gateEligible: refFallbackSummary.gateEligible === true,
      gateBlockedByBoundary: refFallbackSummary.gateBlockedByBoundary === true,
      called: refFallbackSummary.called === true,
      outputType: refFallbackSummary.outputType ?? null,
      confidence: typeof refFallbackSummary.confidence === 'number' ? refFallbackSummary.confidence : 0,
      threshold: typeof refFallbackSummary.threshold === 'number' ? refFallbackSummary.threshold : REF_FALLBACK_CONFIDENCE_THRESHOLD,
      decision: refFallbackSummary.decision,
      finalEffect: refFallbackSummary.finalEffect ?? null,
      clampApplied: refFallbackSummary.clampApplied === true
    }
  });

  const shortSid = sessionId ? sessionId.slice(-8) : 'unknown';
  console.log(
    `[REF_FALLBACK_SUMMARY] sid=${shortSid}` +
    ` gateChecked=${refFallbackSummary.gateChecked ? 1 : 0}` +
    ` eligible=${refFallbackSummary.gateEligible ? 1 : 0}` +
    ` blockedByBoundary=${refFallbackSummary.gateBlockedByBoundary ? 1 : 0}` +
    ` called=${refFallbackSummary.called ? 1 : 0}` +
    ` out=${refFallbackSummary.outputType || 'null'}` +
    ` conf=${typeof refFallbackSummary.confidence === 'number' ? refFallbackSummary.confidence : 0}` +
    ` thr=${typeof refFallbackSummary.threshold === 'number' ? refFallbackSummary.threshold : REF_FALLBACK_CONFIDENCE_THRESHOLD}` +
    ` decision=${refFallbackSummary.decision}` +
    ` finalEffect=${refFallbackSummary.finalEffect || 'null'}` +
    ` clamp=${refFallbackSummary.clampApplied ? 1 : 0}`
  );
};
