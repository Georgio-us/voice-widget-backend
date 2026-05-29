import { OpenAI } from 'openai';
// DB repository (Postgres)
import { logEvent, EventTypes, buildPayload } from '../services/eventLogger.js';
import {
  getAllNormalizedProperties,
  getRankedProperties
} from '../services/audioPropertySearchService.js';
import {
  normalizeCardIdValue
} from '../services/audioPropertySearchUtils.js';
import {
  detectCardIntent,
  detectExplicitChoiceMarker
} from '../services/chatIntentPolicy.js';
import {
  buildLlmContextPack,
  buildShapedFactsPackForLLM,
  logCtx
} from '../services/llmContextPack.js';
import { INSIGHT_FIELDS } from '../services/insightsProfilePolicy.js';
// Session-level logging: логирование целого диалога по одной строке на сессию
import { appendMessage } from '../services/sessionLogger.js';
import {
  getUiLanguage,
  normalizeUiLanguage
} from '../services/audioLanguagePolicy.js';
import { triggerCompletion, triggerHandoff } from '../services/audioHandoffStateService.js';
import { ROLE_SEARCH_READY, transitionRole } from '../services/audioSessionRoleService.js';
import { buildAudioStructuredMessages } from '../services/audioPromptBuilder.js';
import { callStructuredInsightsLlm } from '../services/audioStructuredLlmService.js';
import { processStructuredMeta } from '../services/audioMetaProcessingService.js';
import { buildAssistantUiDecision } from '../services/audioUiDecisionService.js';
import { applyVerbalSelectUiDecision } from '../services/audioVerbalSelectService.js';
import { createAudioSessionStore, generateSessionId } from '../services/audioSessionStore.js';
import {
  applyCardRenderedInteractionState,
  applyFocusChangedInteractionState,
  applyHandoffCancelInteractionState,
  applySelectInteractionState,
  applySliderEndedInteractionState,
  applySliderStartedInteractionState,
  applyUnknownInteractionState
} from '../services/audioInteractionStateService.js';
import {
  buildLikeInteractionPayload,
  buildNextInteractionPayload,
  buildShowInteractionPayload,
  ensureInteractionCandidates,
  getInteractionMatchCounts
} from '../services/audioInteractionNavigationService.js';
import {
  buildAudioSessionInfoPayload,
  buildAudioStatsPayload
} from '../services/audioSessionInfoService.js';
import { updateAudioSessionInsightsProgress } from '../services/audioInsightsProgressService.js';
import { handleAudioMiniAppOpen } from '../services/audioMiniAppOpenService.js';
import {
  cleanupExpiredAudioSessions,
  clearAudioSessionById,
  handleAudioSessionClearHttp
} from '../services/audioSessionCleanupService.js';
import { resolveViewerAccessForDebug } from '../services/audioViewerAccessDebugService.js';
import { sendAudioErrorResponse } from '../services/audioErrorResponseService.js';
import {
  createInteractionDebugWrapper,
  recordInteractionDebugTrace
} from '../services/audioInteractionDebugService.js';
import {
  getAudioRequestNetworkMeta,
  initializeNewAudioSessionSideEffects
} from '../services/audioRequestBootstrapService.js';
import { resolveAudioInput } from '../services/audioInputService.js';
import {
  REF_FALLBACK_CONFIDENCE_THRESHOLD,
  classifyReferenceIntentFallbackLLM,
  detectReferenceIntent,
  shouldUseReferenceFallback
} from '../services/audioReferenceIntentService.js';
import { extractAssistantAndMeta } from '../services/audioAssistantMetaParser.js';
import { formatCardForClient } from '../services/audioCardFormatter.js';
import { callOpenAIWithRetry } from '../services/openAiRetryService.js';
import {
  DEPLOY_TAG_SHORT,
  clip,
  extractSpokeCardId,
  getDeployShortOrNull,
  getLatestMatchRuleId,
  isClientDebugEnabled,
  logBuildOnce,
  normalizeForClientDebug
} from '../services/audioDebugUtils.js';
const DISABLE_SERVER_UI = String(process.env.DISABLE_SERVER_UI || '').trim() === '1';
const BOT_CLIENT_ID = String(process.env.BOT_CLIENT_ID || process.env.CLIENT_ID || 'demo').trim() || 'demo';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();
const {
  getOrCreateSession,
  addMessageToSession
} = createAudioSessionStore({ sessions, defaultRole: ROLE_SEARCH_READY });
const cleanupOldSessions = () => cleanupExpiredAudioSessions({ sessions });
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// ====== Вспомогательные функции профиля/META ======

const transcribeAndRespond = async (req, res) => {
  const startTime = Date.now();
  let sessionId = null;
  
  // Извлекаем IP и User-Agent в начале функции, чтобы они были доступны в блоке catch
  const { userIp, userAgent } = getAudioRequestNetworkMeta(req);

  try {
    if (!req.file && !req.body.text) {
      return res.status(400).json({ error: 'Не найден аудиофайл или текст' });
    }

    sessionId = req.body.sessionId || generateSessionId();
    const isNewSession = !sessions.has(sessionId);
    const session = getOrCreateSession(sessionId);
    if (isNewSession === true) {
      initializeNewAudioSessionSideEffects({ req, session, sessionId, userIp, userAgent });
    }
    const clientDebugEnabled = isClientDebugEnabled(req);
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only) — defensive guard
    if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
      session.debugTrace = { items: [] };
    }

    // 🆕 Sprint 2 / Task 11: per-turn fallback observability summary (local, not stored in session)
    const refFallbackSummary = {
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
    };

    const {
      transcription,
      transcriptionTime,
      inputTypeForLog,
      inputType
    } = await resolveAudioInput({ req, openai });

    addMessageToSession(sessionId, 'user', transcription);
    updateAudioSessionInsightsProgress(session, transcription);
    
    // 🆕 Sprint V: детекция reference intent в сообщении пользователя (без интерпретации)
    // 🔧 Hotfix: Reference Detector Stabilization (Roadmap v2)
    const refDetectResult = detectReferenceIntent(transcription);
    session.referenceIntent = refDetectResult ? {
      type: refDetectResult.type,
      detectedAt: refDetectResult.detectedAt,
      source: refDetectResult.source
    } : null;
    
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only) — расширенный payload для reference_detected
    if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
      session.debugTrace = { items: [] };
    }
    const rawSnippet = transcription ? transcription.slice(0, 40) : '';
    // Вычисляем normalized независимо от результата детектора (для диагностики)
    const normalizedForTrace = transcription
      ? String(transcription).toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я\s]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
      : '';
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
    
    // 🔧 Hotfix: временный server log для reference_detected
    const shortSid = sessionId ? sessionId.slice(-8) : 'unknown';
    const focusCardId = session.currentFocusCard?.cardId || null;
    const ambiguousFlag = session.referenceAmbiguity?.isAmbiguous === true;
    const clarificationActive = session.clarificationBoundaryActive === true;
    console.log(`[REF] sid=${shortSid} input=${inputTypeForLog} lang=${session.clientProfile?.language || 'null'} raw="${rawSnippet}" norm="${normalizedForTrace}" intent=${refDetectResult?.type || 'null'} rule=${refDetectResult?.matchRuleId || 'null'} amb=${ambiguousFlag} clar=${clarificationActive} focus=${focusCardId}`);

    // 🆕 Sprint 2 / Task 2: fallback LLM классификатор referenceIntent (server-first merge)
    // Fallback вызывается только если:
    // - детектор не сработал (session.referenceIntent === null)
    // - gate shouldUseReferenceFallback(session, transcription) === true
    let fallbackAppliedForPipeline = false;
    let fallbackAppliedReferenceType = null;
    // Cache LLM context pack used for [CTX] (so client debug facts match that turn)
    let llmContextPackForMainCall = null;
    if (session.referenceIntent == null) {
      // gate is checked only when referenceIntent is null (same condition as before)
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

        // summary fields (observability only)
        refFallbackSummary.outputType = referenceType;
        refFallbackSummary.confidence = confidence;
        refFallbackSummary.threshold = thr;
        refFallbackSummary.decision = decision;

        // server-first merge: применяем только при валидном типе и достаточной уверенности
        if (decision === 'applied') {
          session.referenceIntent = {
            type: referenceType,
            detectedAt: Date.now(),
            source: 'fallback_llm'
          };
          fallbackAppliedForPipeline = true;
          fallbackAppliedReferenceType = referenceType;
        }

        // diagnostics: debugTrace + server log (только когда fallback реально вызван)
        if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
          session.debugTrace = { items: [] };
        }
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

        const safeRaw = rawSnippet.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        const safeNorm = normalizedForTrace.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        console.log(`[REF_FALLBACK] sid=${shortSid} lang=${lang || 'null'} raw="${safeRaw}" norm="${safeNorm}" out=${referenceType || 'null'} conf=${confidence} thr=${thr} decision=${decision} reason=${reasonTag || 'null'}`);
      } else {
        // gate checked but not eligible -> no classifier call
        refFallbackSummary.decision = 'not_called';
      }
    }
    
    // 🆕 Sprint V: детекция ambiguity для reference (детерминированное правило, без интерпретации)
    if (!session.referenceAmbiguity) {
      session.referenceAmbiguity = {
        isAmbiguous: false,
        reason: null,
        detectedAt: null,
        source: 'server_contract'
      };
    }
    
    if (session.referenceIntent === null) {
      // Reference не найден → неоднозначности нет
      session.referenceAmbiguity.isAmbiguous = false;
      session.referenceAmbiguity.reason = null;
      session.referenceAmbiguity.detectedAt = null;
    } else if (session.referenceIntent.type === 'multi') {
      // Multi reference → неоднозначен
      session.referenceAmbiguity.isAmbiguous = true;
      session.referenceAmbiguity.reason = 'multi_reference';
      session.referenceAmbiguity.detectedAt = Date.now();
    } else if (session.referenceIntent.type === 'unknown') {
      // Unknown reference → неоднозначен
      session.referenceAmbiguity.isAmbiguous = true;
      session.referenceAmbiguity.reason = 'unknown_reference';
      session.referenceAmbiguity.detectedAt = Date.now();
    } else if (session.referenceIntent.type === 'single') {
      // Single reference → не неоднозначен (но объект всё равно не выбран)
      session.referenceAmbiguity.isAmbiguous = false;
      session.referenceAmbiguity.reason = null;
      session.referenceAmbiguity.detectedAt = null;
    }
    
    // 🆕 Sprint V: установка clarificationRequired на основе referenceAmbiguity (детерминированное правило)
    if (!session.clarificationRequired) {
      session.clarificationRequired = {
        isRequired: false,
        reason: null,
        detectedAt: null,
        source: 'server_contract'
      };
    }
    
    if (session.referenceAmbiguity.isAmbiguous === true) {
      // Reference неоднозначен → требуется уточнение
      session.clarificationRequired.isRequired = true;
      session.clarificationRequired.reason = session.referenceAmbiguity.reason;
      session.clarificationRequired.detectedAt = Date.now();
    } else {
      // Reference не неоднозначен → уточнение не требуется
      session.clarificationRequired.isRequired = false;
      session.clarificationRequired.reason = null;
      session.clarificationRequired.detectedAt = null;
    }
    
    // 🆕 Sprint V: single-reference binding proposal (предложение cardId из currentFocusCard, только если условия выполнены)
    if (!session.singleReferenceBinding) {
      session.singleReferenceBinding = {
        hasProposal: false,
        proposedCardId: null,
        source: 'server_contract',
        detectedAt: null,
        basis: null
      };
    }
    
    // Правило: proposal только если single reference, не требуется clarification, и есть currentFocusCard
    if (session.referenceIntent?.type === 'single' && 
        session.clarificationRequired.isRequired === false &&
        session.currentFocusCard?.cardId) {
      session.singleReferenceBinding.hasProposal = true;
      session.singleReferenceBinding.proposedCardId = session.currentFocusCard.cardId;
      session.singleReferenceBinding.basis = 'currentFocusCard';
      session.singleReferenceBinding.detectedAt = Date.now();
    } else {
      // Условия не выполнены → proposal отсутствует
      session.singleReferenceBinding.hasProposal = false;
      session.singleReferenceBinding.proposedCardId = null;
      session.singleReferenceBinding.basis = null;
      session.singleReferenceBinding.detectedAt = null;
    }
    
    // 🆕 Sprint V: clarification boundary active (диагностическое поле: активна ли граница уточнения)
    // Если clarificationRequired.isRequired === true, система находится в состоянии clarification_pending
    // и не имеет права использовать proposal / binding / продвигать сценарий
    const prevClarificationBoundaryActive = session.clarificationBoundaryActive === true;
    session.clarificationBoundaryActive = session.clarificationRequired.isRequired === true;
    // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
    if (prevClarificationBoundaryActive !== true && session.clarificationBoundaryActive === true) {
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
      session.debugTrace.items.push({
        type: 'clarification_boundary',
        at: Date.now(),
        payload: { reason: session.clarificationRequired?.reason || null }
      });
    }

    // 🆕 Sprint VI / Task #4: No-Guessing Invariant (server guard, derived state + enforcement)
    // Правило: пока clarificationBoundaryActive === true, запрещено использовать reference/proposal/choice downstream.
    if (!session.noGuessingInvariant) {
      session.noGuessingInvariant = { active: false, reason: null, enforcedAt: null };
    }
    if (session.clarificationBoundaryActive === true) {
      session.noGuessingInvariant.active = true;
      session.noGuessingInvariant.reason = 'clarification_required';
      session.noGuessingInvariant.enforcedAt = Date.now();
    } else {
      // derived state: если boundary не активна — инвариант не активен
      session.noGuessingInvariant.active = false;
      session.noGuessingInvariant.reason = null;
      session.noGuessingInvariant.enforcedAt = null;
    }

    // Enforcement (поверх существующих блоков, без переписывания логики):
    // - пока noGuessingInvariant.active === true: proposal должен быть отключён (hasProposal=false)
    //   это также блокирует фиксацию explicit choice в текущем проходе (условие explicit choice требует hasProposal=true)
    if (session.noGuessingInvariant.active === true) {
      // Safe reset: не создаём новый объект и не трогаем поля кроме hasProposal/proposedCardId
      if (session.singleReferenceBinding) {
        session.singleReferenceBinding.hasProposal = false;
        session.singleReferenceBinding.proposedCardId = null;
      }
    }

    // 🆕 Sprint VI / Task #1: Candidate Shortlist append (server-side, observation only)
    // Разрешённый источник (ТОЛЬКО): single-reference binding proposal (focus_proposal)
    // Условия:
    // - session.singleReferenceBinding.hasProposal === true
    // - clarificationBoundaryActive === false
    // Правила:
    // - идемпотентно (один cardId — один раз)
    // - только append (без удаления/очистки)
    // - без связи с legacy like / shownSet / lastShown
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

    // 🆕 Sprint VI / Task #2: Explicit Choice Event (infrastructure only)
    // Устанавливается ТОЛЬКО при одновременном выполнении условий:
    // - singleReferenceBinding.hasProposal === true
    // - clarificationBoundaryActive === false
    // - есть proposedCardId
    // - текст содержит строгий whitelist-маркер явного выбора
    // Если хотя бы одно условие не выполнено → explicitChoiceEvent НЕ устанавливается.
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
        // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
        if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
          session.debugTrace = { items: [] };
        }
        session.debugTrace.items.push({
          type: 'explicit_choice',
          at: Date.now(),
          payload: { cardId: session.explicitChoiceEvent.cardId || null }
        });
      }
    }

    // 🆕 Sprint VI Micro Task: reflect explicitChoiceEvent into candidateShortlist (as separate source)
    // Условия (все одновременно):
    // - explicitChoiceEvent.isConfirmed === true
    // - explicitChoiceEvent.cardId truthy
    // - noGuessingInvariant.active !== true
    // - идемпотентно по (cardId, source='explicit_choice_event')
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

    // 🆕 Sprint VI / Task #3: Choice Confirmation Boundary (infrastructure only)
    // Write-path: после обработки explicitChoiceEvent.
    // Если explicitChoiceEvent.isConfirmed === true → активируем boundary (один раз, без auto-reset).
    // Если explicitChoiceEvent не подтверждён → boundary не активируется (и не сбрасывается).
    if (!session.choiceConfirmationBoundary) {
      session.choiceConfirmationBoundary = { active: false, chosenCardId: null, detectedAt: null, source: null };
    }
    if (session.choiceConfirmationBoundary.active !== true && session.explicitChoiceEvent?.isConfirmed === true && Boolean(session.explicitChoiceEvent?.cardId) && session.noGuessingInvariant?.active !== true) {
      session.choiceConfirmationBoundary.active = true;
      session.choiceConfirmationBoundary.chosenCardId = session.explicitChoiceEvent.cardId || null;
      session.choiceConfirmationBoundary.detectedAt = session.explicitChoiceEvent.detectedAt || null;
      session.choiceConfirmationBoundary.source = 'explicit_choice_event';
      // 🆕 Sprint VII / Task #2: Debug Trace (diagnostics only)
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
      session.debugTrace.items.push({
        type: 'choice_boundary',
        at: Date.now(),
        payload: { cardId: session.choiceConfirmationBoundary.chosenCardId || null }
      });
    }

    // 🆕 Sprint 2 / Task 4: ensure fallback-applied intent enters the same reference pipeline
    // Логируем только при decision=applied (fallbackAppliedForPipeline=true) и только после того,
    // как server pipeline (ambiguity/clarification/binding/shortlist/choiceBoundary) уже отработал.
    if (fallbackAppliedForPipeline === true) {
      const amb = session.referenceAmbiguity?.isAmbiguous === true;
      const clarReq = session.clarificationRequired?.isRequired === true;
      const clarBoundary = session.clarificationBoundaryActive === true;
      const hasProposalBeforeClamp = session.singleReferenceBinding?.hasProposal === true;
      const finalEffect = (amb === true || clarReq === true || clarBoundary === true)
        ? 'clarification'
        : (hasProposalBeforeClamp === true ? 'binding' : 'clarification');

      // Sprint 2 / Task 7 micro-fix: server-first clamp after fallback pipeline
      // Если итоговый эффект — clarification, то не оставляем "эффекты выбора" (binding/choice).
      const clampApplied = finalEffect === 'clarification';
      if (clampApplied === true) {
        // Снять proposal (не трогаем остальные поля singleReferenceBinding)
        if (session.singleReferenceBinding) {
          session.singleReferenceBinding.hasProposal = false;
          session.singleReferenceBinding.proposedCardId = null;
        }
        // Снять "подтверждение выбора"
        if (session.explicitChoiceEvent) {
          session.explicitChoiceEvent.isConfirmed = false;
          if ('cardId' in session.explicitChoiceEvent) {
            session.explicitChoiceEvent.cardId = null;
          }
        }
        // Снять boundary выбора
        if (session.choiceConfirmationBoundary) {
          session.choiceConfirmationBoundary.active = false;
          if ('chosenCardId' in session.choiceConfirmationBoundary) {
            session.choiceConfirmationBoundary.chosenCardId = null;
          }
        }
      }

      // Диагностика: после clamp (чтобы отражать финальное состояние)
      const hasProposal = session.singleReferenceBinding?.hasProposal === true;
      const proposedCardId = session.singleReferenceBinding?.proposedCardId || null;
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
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

      // Sprint 2 / Task 11: summary final outcome after pipeline (observability only)
      refFallbackSummary.finalEffect = finalEffect;
      refFallbackSummary.clampApplied = clampApplied === true;
    }
    
    // 🆕 Sprint III: переход role по событию user_message
    transitionRole(session, 'user_message');

    // Логируем сообщение пользователя (event-level logging - существующая телеметрия)
    const audioDurationMs = req.file ? null : null; // TODO: можно добавить извлечение длительности из аудио
    
    logEvent({
      sessionId,
      eventType: EventTypes.USER_MESSAGE,
      userIp,
      userAgent,
      source: 'backend',
      payload: buildPayload({
        inputType: inputTypeForLog,
        text: transcription,
        textLength: transcription.length,
        audioDurationMs,
        stage: session.stage,
        clientProfile: {
          language: session.clientProfile.language,
          location: session.clientProfile.location,
          budgetMin: session.clientProfile.budgetMin,
          budgetMax: session.clientProfile.budgetMax,
          purpose: session.clientProfile.purpose,
          propertyType: session.clientProfile.propertyType,
          urgency: session.clientProfile.urgency
        },
        insights: session.insights,
        cardsCount: session.shownSet ? session.shownSet.size : 0
      })
    }).catch(err => {
      console.error('❌ Failed to log user_message event:', err);
    });

    // Session-level logging: добавляем сообщение пользователя в session_logs
    appendMessage({
      sessionId,
      role: 'user',
      message: {
        inputType: inputTypeForLog,
        text: transcription, // текст всегда есть (либо из транскрипции, либо прямой ввод)
        ...(req.file ? { transcription: transcription } : {}), // для аудио дублируем в transcription
        meta: {
          stage: session.stage,
          insights: session.insights
        }
      },
      userAgent,
      userIp
    }).catch(err => {
      console.error('❌ Failed to append user message to session log:', err);
    });

    // const totalProps = properties.length; // устарело – переезд на БД
    const detectedLangFromText = (() => {
      const sample = (transcription || req.body.text || '').toString();
      if (/^[\s\S]*[А-Яа-яЁё]/.test(sample)) return 'ru';
      if (/^[\s\S]*[a-zA-Z]/.test(sample)) return 'en';
      return null;
    })();
    const targetLang = normalizeUiLanguage(req.body?.lang);

    // Product contract: assistant language follows UI language, not Whisper/text detection.
    // Default UI language is Ukrainian; Russian is used only after explicit UI switch.
    session.clientProfile.language = targetLang;

    const {
      messages,
      demoCatalogContext,
      demoPromptFlavorContext
    } = await buildAudioStructuredMessages({
      session,
      targetLang,
      clientId: process.env.CLIENT_ID || 'georgio-us',
      logger: console
    });

    // RMv3 / Sprint 1: transient LLM Context Pack + [CTX] log (infrastructure only)
    llmContextPackForMainCall = buildLlmContextPack(session, sessionId, 'main');
    logCtx(llmContextPackForMainCall, { deployTagShort: DEPLOY_TAG_SHORT, logBuildOnce });
    const {
      gptTime,
      promptTokens,
      completionTokens,
      totalTokens,
      rawModelContent,
      parsedStructured,
      fallbackUsed
    } = await callStructuredInsightsLlm({ openai, messages });

    const assistantText = parsedStructured.assistantText;
    const meta = parsedStructured.meta;
    const metaRaw = parsedStructured.raw;
    const parseError = parsedStructured.parseError;
    try {
      const sid = String(sessionId || '').slice(-8) || 'unknown';
      console.log(`[META_RAW] sid=${sid} ${JSON.stringify(meta ?? null)}`);
    } catch {
      console.log('[META_RAW] failed_to_stringify');
    }
    const fallbackBotResponse = targetLang === 'ru'
      ? 'Хорошо, уточню детали и вернусь с лучшими вариантами.'
      : (targetLang === 'en'
        ? 'Okay, I will clarify the details and return with suitable options.'
        : 'Добре, уточню деталі й повернуся з відповідними варіантами.');
    let botResponse = assistantText || rawModelContent || fallbackBotResponse;
    session.clientProfile.language = targetLang;

    // Patch (outside roadmap): client-visible bind vs spoke measurement (Safari DevTools)
    const spoke = extractSpokeCardId(botResponse);
    const bindHas = session.singleReferenceBinding?.hasProposal === true;
    const bindCardId = session.singleReferenceBinding?.proposedCardId || null;
    const mismatchBindVsSpoke = (bindHas && spoke.cardId && spoke.cardId !== bindCardId) ? 1 : 0;
    if (mismatchBindVsSpoke === 1) {
      const rule = getLatestMatchRuleId(session);
      console.log(`[MISMATCH] sid=${String(sessionId || '').slice(-8) || 'unknown'} bind=${bindCardId || 'null'} spoke=${spoke.cardId || 'null'} focus=${session.currentFocusCard?.cardId || 'null'} lastShown=${session.lastShown?.cardId || 'null'} rule=${rule || 'null'}`);
    }

    const {
      extractionReport,
      extractionInvalidFields
    } = await processStructuredMeta({
      session,
      sessionId,
      meta,
      metaRaw,
      parseError,
      fallbackUsed,
      transcription,
      clientId: process.env.CLIENT_ID || 'georgio-us',
      logger: console
    });

    if (extractionReport.updatesApplied === true) {
      const suffix = targetLang === 'ru'
        ? "\n\nНажми «Объекты найдены» 👆, чтобы просмотреть подборку"
        : "\n\nТисни «Об'єкти знайдено» 👆, щоб переглянути підбірку";
      botResponse += suffix;
    }

    // 🔎 Детектор намерения/вариантов
    const { variants } = detectCardIntent(transcription);

    // UI extras and cards container
    let cards = [];
    let { ui } = buildAssistantUiDecision({ transcription, targetLang, extractionReport });
    // (удалено) парсинг inline lead из текста и сигналы формы
    // прогресс не используется как гейт выдачи контента

   /*
    * УДАЛЁН БЛОК «текстового списка вариантов» (preview-список).
    *
    * Что было:
    * - При достаточном контексте или явном запросе «варианты» генерировался текст:
    *   «У меня есть N вариант(а) из M в базе: ...» с 2–3 строками примеров.
    * - Одновременно сохранялись session.lastCandidates, lastListAt/lastListHash
    *   для антиспама и «якорения» пула кандидатов без показа карточек.
    *
    * Почему убрали:
    * - UX: пользователи ожидают сразу карточки, а не «числа и список строк»; текст создаёт шум.
    * - Несоответствие ожиданиям: подсказка «Сказать „покажи“...» дублирует UI и конфузит.
    * - Надёжность: антиспам по времени/хешу инсайтов давал неочевидные ветки (молчание/повтор),
    *   а цифры «N из M» легко устаревают или воспринимаются как обещание полного каталога.
    * - Мультиязычность: строка не была локализована, что создавало рассинхрон с интерфейсом.
    *
    * Текущая логика:
    * - Пул кандидатов формируется лениво при явном «показать»/навигации по карточкам (см. ниже).
    * - UI предлагает карточку напрямую; числовые «N из M» больше не показываем.
    */

    ({ botResponse, ui } = applyVerbalSelectUiDecision({ transcription, session, botResponse, ui }));

    // Если пользователь просит запись/встречу — (удалено) лид-форма не используется

    // (удалено) проактивные предложения лид-формы

    addMessageToSession(sessionId, 'assistant', botResponse);

    const totalTime = Date.now() - startTime;

    // Логируем успешный ответ ассистента
    const messageId = `${sessionId}_${Date.now()}`;
    // inputTypeForLog уже объявлен в начале функции
    
    // Подготавливаем данные о карточках для логирования (только ключевые поля)
    const cardsForLog = Array.isArray(cards) && cards.length > 0
      ? cards.map(card => ({
          id: card.id,
          city: card.city || null,
          district: card.district || null,
          priceEUR: card.priceEUR || null,
          rooms: card.rooms || null
        }))
      : [];
    
    // Короткий отрывок сообщения (первые 200 символов)
    const messageText = botResponse ? botResponse.substring(0, 200) : null;
    
    logEvent({
      sessionId,
      eventType: EventTypes.ASSISTANT_REPLY,
      userIp,
      userAgent,
      source: 'backend',
      payload: buildPayload({
        messageId,
        messageText,
        hasCards: cards.length > 0,
        cards: cardsForLog,
        inputType: inputTypeForLog,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens
        },
        timing: {
          transcription: transcriptionTime,
          gpt: gptTime,
          total: totalTime
        },
        stage: session.stage,
        insights: session.insights
      })
    }).catch(err => {
      console.error('❌ Failed to log assistant_reply event:', err);
    });

    // Session-level logging: добавляем ответ ассистента в session_logs
    appendMessage({
      sessionId,
      role: 'assistant',
      message: {
        text: botResponse,
        cards: cardsForLog,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens
        },
        timing: {
          transcription: transcriptionTime,
          gpt: gptTime,
          total: totalTime
        },
        meta: {
          stage: session.stage,
          insights: session.insights
        }
      },
      userAgent,
      userIp
    }).catch(err => {
      console.error('❌ Failed to append assistant message to session log:', err);
    });

    // 🆕 Sprint 2 / Task 11: one summary per user turn (only if fallback was considered)
    if (refFallbackSummary.gateChecked === true || refFallbackSummary.called === true) {
      if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
        session.debugTrace = { items: [] };
      }
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
    }

    const { totalMatches, strictMatches, relaxedMatches, ranked } = await getRankedProperties(session.insights);

    const viewerAccess = await resolveViewerAccessForDebug(req);
    const isSuperAdminViewer = viewerAccess?.isSuperAdmin === true;

    const responsePayload = {
      response: botResponse,
      transcription,
      sessionId,
      messageCount: session.messages.length,
      inputType,
      clientProfile: session.clientProfile,
      stage: session.stage,
      role: session.role, // 🆕 Sprint I: server-side role
      insights: session.insights, // 🆕 Теперь содержит все 9 параметров
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
      // ui пропускается, если undefined; cards может быть пустым массивом
      cards: DISABLE_SERVER_UI ? [] : cards,
      ui: DISABLE_SERVER_UI ? undefined : ui,
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

    // Patch (outside roadmap): Browser-visible compact debug (only under exact gate)
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

    res.json(responsePayload);

  } catch (error) {
    return sendAudioErrorResponse({ req, res, error, sessionId, userIp, userAgent });
  }
};

const handleMiniAppOpen = (req, res) => handleAudioMiniAppOpen({ req, res, clientId: BOT_CLIENT_ID });

const clearSessionById = (sessionId) => {
  clearAudioSessionById({ sessions, sessionId });
};

const clearSessionHttp = (req, res) => {
  return handleAudioSessionClearHttp({ req, res, sessions, clearSessionById });
};

// ✅ Получить статистику всех активных сессий
const getStats = (req, res) => {
  res.json(buildAudioStatsPayload(sessions));
};

// ✅ Получение полной информации о сессии по ID
const getSessionInfo = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const session = sessions.get(sessionId);
    const verbose = ['1', 'true', 'yes', 'on'].includes(String(req?.query?.verbose || '').trim().toLowerCase());

    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    return res.json(await buildAudioSessionInfoPayload({ req, sessionId, session, verbose }));
  } catch (e) {
    console.error('getSessionInfo error:', e);
    res.status(500).json({ error: 'internal' });
  }
};

// ✅ Экспорт всех нужных функций
export {
  transcribeAndRespond,
  clearSessionById,
  clearSessionHttp,
  getSessionInfo,
  getStats,
  handleMiniAppOpen,
  handleInteraction,
  triggerHandoff,
  triggerCompletion,
  shouldUseReferenceFallback
};

// ---------- Взаимодействия (like / next) ----------
async function handleInteraction(req, res) {
  try {
    const { action, variantId: rawVariantId, sessionId } = req.body || {};
    const variantId = normalizeCardIdValue(rawVariantId);
    if (!action || !sessionId) return res.status(400).json({ error: 'action и sessionId обязательны' });
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
    const withDebug = createInteractionDebugWrapper({ req, session, sessionId, action });
    recordInteractionDebugTrace(session, action);

    await ensureInteractionCandidates(session);
    const { totalMatches, strictMatches, relaxedMatches } = await getInteractionMatchCounts(session);
    const counts = { totalMatches, strictMatches, relaxedMatches };

    if (action === 'show') {
      const result = await buildShowInteractionPayload({ req, session, variantId, counts });
      return res.status(result.status || 200).json(withDebug(result.payload));
    }

    if (action === 'next') {
      const result = await buildNextInteractionPayload({ req, session, variantId, counts });
      return res.status(result.status || 200).json(withDebug(result.payload));
    }

    if (action === 'like') {
      return res.json(withDebug(buildLikeInteractionPayload({ session, variantId, counts })));
    }

    // RMv3 / Sprint 1 / Task 1: факт выбора карточки пользователем (UI "Выбрать") — server-first
    // ВАЖНО:
    // - не запускает handoff
    // - не меняет role/stage
    // - не трогает LLM
    if (action === 'select') {
      const result = applySelectInteractionState(session, variantId);
      if (result.ok !== true) return res.status(result.status || 400).json({ error: result.error || 'bad request' });
      return res.json(withDebug({ ok: true, totalMatches, strictMatches, relaxedMatches, role: session.role }));
    }

    // RMv3 / Sprint 2 / Task 2.4: server-fact cancel из in-dialog lead block
    // ВАЖНО:
    // - не трогает role/stage
    // - не вызывает LLM
    // - не трогает lead-flow
    if (action === 'handoff_cancel') {
      applyHandoffCancelInteractionState(session);
      return res.json(withDebug({ ok: true, totalMatches, strictMatches, relaxedMatches, role: session.role }));
    }

    // 🆕 Sprint I: подтверждение факта рендера карточки в UI
    if (action === 'ui_card_rendered') {
      const result = await applyCardRenderedInteractionState({
        session,
        sessionId,
        variantId,
        getAllNormalizedProperties,
        logger: console
      });
      if (result.ok !== true) return res.status(result.status || 400).json({ error: result.error || 'bad request' });
      return res.json(withDebug({ ok: true, totalMatches, strictMatches, relaxedMatches, role: session.role })); // 🆕 Sprint I: server-side role
    }

    // 🆕 Sprint IV: обработка события ui_slider_started для фиксации активности slider
    if (action === 'ui_slider_started') {
      applySliderStartedInteractionState(session, sessionId, console);
      return res.json(withDebug({ ok: true, totalMatches, strictMatches, relaxedMatches, role: session.role }));
    }

    // 🆕 Sprint III: обработка события ui_slider_ended для перехода role
    // 🆕 Sprint IV: также обновляем sliderContext при завершении slider
    if (action === 'ui_slider_ended') {
      applySliderEndedInteractionState(session, sessionId, console);
      return res.json(withDebug({ ok: true, totalMatches, strictMatches, relaxedMatches, role: session.role })); // 🆕 Sprint I: server-side role
    }

    // 🆕 Sprint IV: обработка события ui_focus_changed для фиксации текущей карточки в фокусе
    if (action === 'ui_focus_changed') {
      const result = applyFocusChangedInteractionState(session, req?.body?.cardId, sessionId, console);
      if (result.ok !== true) return res.status(result.status || 400).json({ error: result.error || 'bad request' });
      return res.json(withDebug({ ok: true, totalMatches, strictMatches, relaxedMatches, role: session.role }));
    }

    // 🆕 Sprint VII / Task #1: Unknown UI Action Capture (diagnostics only)
    // Неизвестный action не должен ломать выполнение и не должен вызывать side-effects.
    applyUnknownInteractionState(session, action, req.body);
    return res.json(withDebug({ ok: true, totalMatches, strictMatches, relaxedMatches, role: session.role }));
  } catch (e) {
    console.error('interaction error:', e);
    res.status(500).json({ error: 'internal' });
  }
}
