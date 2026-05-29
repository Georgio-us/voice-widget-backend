import { buildAllowedFactsSnapshot } from './audioAllowedFactsService.js';
import { transitionRole } from './audioSessionRoleService.js';
import { normalizeCardIdValue } from './audioPropertySearchUtils.js';

const ensureHandoffState = (session) => {
  if (!session.handoff) {
    session.handoff = { active: false, shownAt: null, cardId: null, canceled: false, canceledAt: null };
  }
  return session.handoff;
};

const ensureSelectedCardState = (session) => {
  if (!session.selectedCard) {
    session.selectedCard = { cardId: null, selectedAt: null };
  }
  return session.selectedCard;
};

export const applySelectInteractionState = (session, rawVariantId) => {
  const cardId = normalizeCardIdValue(rawVariantId);
  if (!cardId) {
    return { ok: false, status: 400, error: 'variantId обязателен для select' };
  }
  const now = Date.now();
  const selectedCard = ensureSelectedCardState(session);
  selectedCard.cardId = cardId;
  selectedCard.selectedAt = now;

  const handoff = ensureHandoffState(session);
  handoff.active = true;
  handoff.shownAt = now;
  handoff.cardId = selectedCard.cardId;
  handoff.canceled = false;
  handoff.canceledAt = null;

  return { ok: true, cardId };
};

export const applyHandoffCancelInteractionState = (session) => {
  const now = Date.now();
  const handoff = ensureHandoffState(session);
  handoff.active = false;
  handoff.canceled = true;
  handoff.canceledAt = now;
  handoff.cardId = null;

  const selectedCard = ensureSelectedCardState(session);
  selectedCard.cardId = null;
  selectedCard.selectedAt = null;

  return { ok: true };
};

export const applyCardRenderedInteractionState = async ({
  session,
  sessionId,
  variantId,
  getAllNormalizedProperties,
  logger = console
} = {}) => {
  if (!variantId) {
    return { ok: false, status: 400, error: 'variantId обязателен для ui_card_rendered' };
  }

  if (!session.shownSet) session.shownSet = new Set();
  session.shownSet.add(variantId);

  if (!session.lastShown) {
    session.lastShown = { cardId: null, updatedAt: null };
  }
  session.lastShown.cardId = variantId;
  session.lastShown.updatedAt = Date.now();

  transitionRole(session, 'ui_card_rendered');

  try {
    const all = await getAllNormalizedProperties();
    const cardData = all.find(p => p.id === variantId);
    if (cardData) {
      session.allowedFactsSnapshot = buildAllowedFactsSnapshot(cardData, variantId);
      logger?.log?.(`✅ [Sprint II] allowedFactsSnapshot наполнен фактами карточки ${variantId} по schema (сессия ${String(sessionId || '').slice(-8)})`);
    } else {
      logger?.warn?.(`⚠️ [Sprint II] Карточка ${variantId} не найдена для наполнения snapshot`);
    }
  } catch (error) {
    logger?.error?.('❌ [Sprint II] Ошибка при наполнении allowedFactsSnapshot:', error);
  }

  logger?.log?.(`✅ [Sprint I] Карточка ${variantId} зафиксирована как показанная в UI (сессия ${String(sessionId || '').slice(-8)})`);
  return { ok: true };
};

export const applySliderStartedInteractionState = (session, sessionId, logger = console) => {
  if (!session.sliderContext) {
    session.sliderContext = { active: false, updatedAt: null };
  }
  session.sliderContext.active = true;
  session.sliderContext.updatedAt = Date.now();
  logger?.log?.(`📱 [Sprint IV] Slider стал активным (сессия ${String(sessionId || '').slice(-8)})`);
  return { ok: true };
};

export const applySliderEndedInteractionState = (session, sessionId, logger = console) => {
  transitionRole(session, 'ui_slider_ended');
  if (!session.sliderContext) {
    session.sliderContext = { active: false, updatedAt: null };
  }
  session.sliderContext.active = false;
  session.sliderContext.updatedAt = Date.now();
  logger?.log?.(`📱 [Sprint IV] Slider стал неактивным (сессия ${String(sessionId || '').slice(-8)})`);
  return { ok: true };
};

export const applyFocusChangedInteractionState = (session, rawCardId, sessionId, logger = console) => {
  const cardId = normalizeCardIdValue(rawCardId);
  if (!cardId) {
    logger?.warn?.(`⚠️ [Sprint IV] ui_focus_changed с невалидным cardId (сессия ${String(sessionId || '').slice(-8)})`);
    return { ok: false, status: 400, error: 'cardId is required and must be a non-empty string' };
  }

  if (!session.currentFocusCard) {
    session.currentFocusCard = { cardId: null, updatedAt: null };
  }

  session.currentFocusCard.cardId = cardId;
  session.currentFocusCard.updatedAt = Date.now();
  session.lastFocusSnapshot = {
    cardId,
    updatedAt: Date.now()
  };

  logger?.log?.(`🎯 [Sprint IV] Focus изменён на карточку ${cardId} (сессия ${String(sessionId || '').slice(-8)})`);
  return { ok: true, cardId };
};

export const applyUnknownInteractionState = (session, action, body = {}) => {
  if (!session.unknownUiActions || !Array.isArray(session.unknownUiActions.items)) {
    session.unknownUiActions = { count: 0, items: [] };
  }
  session.unknownUiActions.count += 1;
  session.unknownUiActions.items.push({
    action: String(action),
    payload: body ? { ...body } : null,
    detectedAt: Date.now()
  });
  return { ok: true };
};
