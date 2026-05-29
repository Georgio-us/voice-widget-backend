export const triggerHandoff = (session, reason = 'lead_submitted') => {
  if (!session) {
    console.warn('⚠️ [Sprint III] triggerHandoff вызван без session');
    return false;
  }

  if (session.handoffDone) {
    console.log(`ℹ️ [Sprint III] Handoff уже выполнен для сессии ${session.sessionId?.slice(-8) || 'unknown'}`);
    return false;
  }

  if (!session.leadSnapshot) {
    const snapshotAt = Date.now();
    session.leadSnapshot = {
      sessionId: session.sessionId || null,
      createdAt: session.createdAt || null,
      snapshotAt,
      clientProfile: session.clientProfile ? { ...session.clientProfile } : null,
      insights: session.insights ? { ...session.insights } : null,
      likedProperties: Array.isArray(session.liked) ? [...session.liked] : null,
      shownProperties: session.shownSet ? Array.from(session.shownSet) : null
    };
    session.leadSnapshotAt = snapshotAt;
    console.log(`📸 [Sprint III] Lead snapshot создан для сессии ${session.sessionId?.slice(-8) || 'unknown'}`);
  }

  session.handoffDone = true;
  session.handoffAt = Date.now();
  console.log(`✅ [Sprint III] Handoff установлен для сессии ${session.sessionId?.slice(-8) || 'unknown'} (reason: ${reason})`);
  return true;
};

export const triggerCompletion = (session, reason = 'post_handoff_cycle_complete') => {
  if (!session) {
    console.warn('⚠️ [Sprint III] triggerCompletion вызван без session');
    return false;
  }

  if (!session.handoffDone) {
    console.warn(`⚠️ [Sprint III] Completion невозможен до handoff (сессия ${session.sessionId?.slice(-8) || 'unknown'})`);
    return false;
  }

  if (session.completionDone) {
    console.log(`ℹ️ [Sprint III] Completion уже выполнен для сессии ${session.sessionId?.slice(-8) || 'unknown'}`);
    return false;
  }

  session.completionDone = true;
  session.completionAt = Date.now();
  session.completionReason = reason;
  console.log(`✅ [Sprint III] Completion установлен для сессии ${session.sessionId?.slice(-8) || 'unknown'} (reason: ${reason})`);
  return true;
};
