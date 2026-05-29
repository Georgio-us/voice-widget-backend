import { finalizeSessionActivityNotifications } from './audioSessionActivityFinalizer.js';

export const cleanupExpiredAudioSessions = ({ sessions, ttlMs = 60 * 60 * 1000 } = {}) => {
  const cutoff = Date.now() - ttlMs;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < cutoff) {
      try { finalizeSessionActivityNotifications(session, sessionId); } catch {}
      sessions.delete(sessionId);
    }
  }
};

export const clearAudioSessionById = ({ sessions, sessionId }) => {
  try {
    const session = sessions.get(sessionId);
    finalizeSessionActivityNotifications(session, sessionId);
  } catch {}
  sessions.delete(sessionId);
};

export const handleAudioSessionClearHttp = ({ req, res, sessions, clearSessionById }) => {
  try {
    const sessionId = String(req?.params?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' });
    }
    const existed = sessions.has(sessionId);
    clearSessionById(sessionId);
    return res.json({ ok: true, cleared: existed, sessionId });
  } catch (error) {
    console.error('clearSessionHttp error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
};
