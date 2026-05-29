import {
  getDeployShortOrNull,
  isClientDebugEnabled
} from './audioDebugUtils.js';

export const recordInteractionDebugTrace = (session, action) => {
  if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
    session.debugTrace = { items: [] };
  }
  session.debugTrace.items.push({
    type: 'ui_action',
    at: Date.now(),
    payload: { action }
  });
};

export const createInteractionDebugWrapper = ({ req, session, sessionId, action }) => {
  const clientDebugEnabled = isClientDebugEnabled(req);
  return (payload) => {
    if (clientDebugEnabled !== true) return payload;
    return {
      ...payload,
      debug: {
        deploy: getDeployShortOrNull(),
        sid: String(sessionId || '').slice(-8) || 'unknown',
        ts: Date.now(),
        action: String(action),
        ui: {
          focus: session.currentFocusCard?.cardId || null,
          lastShown: session.lastShown?.cardId || null,
          slider: session.sliderContext?.active === true ? 1 : 0
        }
      }
    };
  };
};
