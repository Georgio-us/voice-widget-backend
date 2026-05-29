export const ROLE_SEARCH_READY = 'search_ready';

export const transitionRole = (session, event) => {
  const currentRole = session?.role || ROLE_SEARCH_READY;
  if (!session) return false;
  if (!session.debugTrace || !Array.isArray(session.debugTrace.items)) {
    session.debugTrace = { items: [] };
  }
  session.role = ROLE_SEARCH_READY;
  session.debugTrace.items.push({
    type: 'role_transition',
    at: Date.now(),
    payload: { from: currentRole, to: session.role, event }
  });
  return true;
};
