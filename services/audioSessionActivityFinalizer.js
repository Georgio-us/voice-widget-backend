import { updateSessionActivityFinalToTelegram } from './telegramNotifier.js';
import { updateSessionActivityFinalToProjectTelegram } from './projectTelegramNotifier.js';

const buildFinalActivityPayload = (session, sessionId) => ({
  sessionId: session?.sessionId || sessionId,
  startedAt: session?.createdAt ?? null,
  lastActivityAt: session?.lastActivity ?? null,
  durationMs: (typeof session?.createdAt === 'number' && typeof session?.lastActivity === 'number')
    ? Math.max(0, session.lastActivity - session.createdAt)
    : null,
  geo: session?.geo || null,
  messageCount: Array.isArray(session?.messages) ? session.messages.length : null,
  sliderReached: !!(session?.sliderContext && session.sliderContext.updatedAt),
  insights: session?.insights || null,
  cardsShownCount: session?.shownSet ? (session.shownSet.size || 0) : null,
  likesCount: Array.isArray(session?.liked) ? session.liked.length : null,
  selectedCardId: session?.selectedCard?.cardId || null,
  handoffActive: session?.handoff?.shownAt ? true : (session?.handoff?.active === true),
  handoffCanceled: session?.handoff?.canceled === true
});

export const finalizeSessionActivityNotifications = (session, sessionId) => {
  if (!session) return;

  const messageId = session?.telegram?.activityMessageId || null;
  if (messageId) {
    updateSessionActivityFinalToTelegram({
      messageId,
      ...buildFinalActivityPayload(session, sessionId)
    }).catch(() => {});
  }

  const projectMessageIds = session?.telegramProject?.activityMessageIds || null;
  if (projectMessageIds && typeof projectMessageIds === 'object') {
    updateSessionActivityFinalToProjectTelegram({
      messageIds: projectMessageIds,
      ...buildFinalActivityPayload(session, sessionId)
    }).catch(() => {});
  }
};
