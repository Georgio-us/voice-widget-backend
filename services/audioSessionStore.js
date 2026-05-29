import { buildInitialAudioSession } from './sessionStateFactory.js';

export const generateSessionId = () => `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const createAudioSessionStore = ({ sessions, defaultRole = 'search_ready' } = {}) => {
  if (!sessions || typeof sessions.has !== 'function') {
    throw new Error('createAudioSessionStore requires a Map-like sessions object');
  }

  const getOrCreateSession = (sessionId) => {
    const effectiveSessionId = sessionId || generateSessionId();
    if (!sessions.has(effectiveSessionId)) {
      sessions.set(effectiveSessionId, buildInitialAudioSession(effectiveSessionId, { role: defaultRole }));
    }
    return sessions.get(effectiveSessionId);
  };

  const addMessageToSession = (sessionId, role, content) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.messages.push({ role, content, timestamp: Date.now() });
      session.lastActivity = Date.now();
    }
  };

  return {
    getOrCreateSession,
    addMessageToSession
  };
};
