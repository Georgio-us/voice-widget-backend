import { pool } from './db.js';

export const getUsersJoinStats = async (clientId) => {
  const safeClientId = String(clientId || 'demo').trim() || 'demo';
  const fallback = { totalUsers: null, usersToday: null };
  try {
    const [{ rows: totalRows }, { rows: todayRows }] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE client_id = $1`,
        [safeClientId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE client_id = $1 AND first_seen_at::date = NOW()::date`,
        [safeClientId]
      )
    ]);
    return {
      totalUsers: totalRows?.[0]?.c ?? 0,
      usersToday: todayRows?.[0]?.c ?? 0
    };
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') return fallback;
    throw error;
  }
};
