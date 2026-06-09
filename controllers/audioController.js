import { OpenAI } from 'openai';
import {
  getAllNormalizedProperties,
  getRankedProperties
} from '../services/audioPropertySearchService.js';
import {
  normalizeCardIdValue
} from '../services/audioPropertySearchUtils.js';
import { detectCardIntent } from '../services/chatIntentPolicy.js';
import {
  buildLlmContextPack,
  logCtx
} from '../services/llmContextPack.js';
import { INSIGHT_FIELDS } from '../services/insightsProfilePolicy.js';
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
  logAudioAssistantTurn,
  logAudioUserTurn
} from '../services/audioConversationLoggingService.js';
import { buildAudioResponsePayload } from '../services/audioResponsePayloadService.js';
import { shouldUseReferenceFallback } from '../services/audioReferenceIntentService.js';
import { getManagerCtaReason } from '../services/managerCtaPolicy.js';
import {
  logReferenceFallbackSummary,
  runAudioReferencePipeline
} from '../services/audioReferencePipelineService.js';
import { extractAssistantAndMeta } from '../services/audioAssistantMetaParser.js';
import {
  DEPLOY_TAG_SHORT,
  extractSpokeCardId,
  getLatestMatchRuleId,
  isClientDebugEnabled,
  logBuildOnce
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
const SELECTION_HINT_FIELDS = [
  'operation',
  'type',
  'district',
  'location',
  'rooms',
  'budget',
  'budgetMax',
  'area',
  'areaMin',
  'areaMax',
  'landArea',
  'landAreaMin',
  'landAreaMax',
  'floor',
  'floorNotFirst',
  'floorNotLast',
  'residentialComplex',
  'governmentProgram',
  'eoselia',
  'evidnovlennia'
];

const buildSelectionHintSignature = (insights = {}) => JSON.stringify(
  Object.fromEntries(
    SELECTION_HINT_FIELDS
      .map((field) => [field, insights?.[field]])
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
);

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

    const {
      transcription,
      transcriptionTime,
      inputTypeForLog,
      inputType
    } = await resolveAudioInput({ req, openai });

    addMessageToSession(sessionId, 'user', transcription);
    updateAudioSessionInsightsProgress(session, transcription);

    const { refFallbackSummary } = await runAudioReferencePipeline({
      session,
      sessionId,
      transcription,
      inputTypeForLog,
      openai
    });

    // Cache LLM context pack used for [CTX] (so client debug facts match that turn)
    let llmContextPackForMainCall = null;

    // 🆕 Sprint III: переход role по событию user_message
    transitionRole(session, 'user_message');

    logAudioUserTurn({ req, session, sessionId, transcription, inputTypeForLog, userIp, userAgent });

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

    // 🔎 Детектор намерения/вариантов
    const { variants } = detectCardIntent(transcription);

    // UI extras and cards container
    let cards = [];
    let ui = undefined;
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

    const { totalMatches, strictMatches, relaxedMatches, ranked } = await getRankedProperties(session.insights);
    const selectionHintSignature = buildSelectionHintSignature(session.insights);
    const selectionHintChanged = selectionHintSignature !== session.lastAssistantSelectionHintSignature;
    const selectionUpdated = extractionReport.updatesApplied === true && selectionHintChanged;
    const managerFollowUpReason = getManagerCtaReason(transcription, { updatesApplied: false });
    const assistantUiDecision = buildAssistantUiDecision({
      transcription,
      targetLang,
      extractionReport: {
        ...extractionReport,
        updatesApplied: managerFollowUpReason ? false : selectionUpdated
      }
    });
    ui = {
      ...(assistantUiDecision.ui || {}),
      ...(ui || {})
    };
    if (selectionUpdated) {
      session.lastAssistantSelectionHintSignature = selectionHintSignature;
    }
    if (!managerFollowUpReason && selectionUpdated && Number(totalMatches) > 0) {
      const suffix = targetLang === 'ru'
        ? "\n\nНажми «Объекты найдены» 👆, чтобы просмотреть подборку"
        : "\n\nТисни «Об'єкти знайдено» 👆, щоб переглянути підбірку";
      botResponse += suffix;
    }

    addMessageToSession(sessionId, 'assistant', botResponse);

    const totalTime = Date.now() - startTime;

    const { cardsForLog } = logAudioAssistantTurn({
      sessionId,
      session,
      botResponse,
      cards,
      inputTypeForLog,
      promptTokens,
      completionTokens,
      totalTokens,
      transcriptionTime,
      gptTime,
      totalTime,
      userAgent,
      userIp
    });

    logReferenceFallbackSummary({ session, sessionId, refFallbackSummary });

    const viewerAccess = await resolveViewerAccessForDebug(req);
    const isSuperAdminViewer = viewerAccess?.isSuperAdmin === true;

    const responsePayload = buildAudioResponsePayload({
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
      disableServerUi: DISABLE_SERVER_UI,
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
    });

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
