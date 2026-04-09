import { pool } from './db.js';

const normalizeId = (value) => String(value || '').trim();

export async function getOwnerSubscriptionStatus(ownerTgIdRaw) {
  const ownerTgId = normalizeId(ownerTgIdRaw);
  if (!ownerTgId) return { active: false, plan: null, endsAt: null, daysLeft: 0 };
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        plan,
        status,
        starts_at,
        ends_at,
        activation_source,
        COALESCE(
          CEIL(EXTRACT(EPOCH FROM (ends_at - NOW())) / 86400.0),
          0
        )::int AS days_left
      FROM owner_subscriptions
      WHERE owner_tg_id = $1
        AND status = 'active'
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY starts_at DESC
      LIMIT 1
      `,
      [ownerTgId]
    );
    const row = rows?.[0];
    if (!row) return { active: false, plan: null, endsAt: null, daysLeft: 0 };
    return {
      active: true,
      id: Number(row.id),
      plan: row.plan || null,
      status: row.status || 'active',
      startsAt: row.starts_at || null,
      endsAt: row.ends_at || null,
      activationSource: row.activation_source || null,
      daysLeft: Number.isFinite(Number(row.days_left)) ? Math.max(0, Number(row.days_left)) : 0
    };
  } catch (error) {
    const message = String(error?.message || '');
    if (/relation .*owner_subscriptions.* does not exist/i.test(message)) {
      return { active: false, plan: null, endsAt: null, daysLeft: 0, reason: 'TABLE_MISSING' };
    }
    throw error;
  }
}

export async function resolveViewerAccessByTgId(tgUserIdRaw) {
  const tgUserId = normalizeId(tgUserIdRaw);
  const superAdminId = normalizeId(process.env.SUPER_ADMIN_ID);
  const ownerId = normalizeId(process.env.OWNER_TG_ID);
  const isSuperAdmin = !!(tgUserId && superAdminId && tgUserId === superAdminId);
  const isOwnerIdentity = !!(tgUserId && ownerId && tgUserId === ownerId);

  if (isSuperAdmin) {
    return {
      tgUserId,
      accessRole: 'super_admin',
      isAdmin: true,
      isSuperAdmin: true,
      isOwner: true,
      isOwnerIdentity: true,
      subscription: {
        active: true,
        plan: 'lifetime',
        endsAt: null,
        daysLeft: null,
        source: 'super_admin_bypass'
      }
    };
  }

  if (isOwnerIdentity) {
    const subscription = await getOwnerSubscriptionStatus(tgUserId);
    return {
      tgUserId,
      accessRole: 'owner',
      isAdmin: subscription.active === true,
      isSuperAdmin: false,
      isOwner: true,
      isOwnerIdentity: true,
      subscription
    };
  }

  return {
    tgUserId,
    accessRole: 'user',
    isAdmin: false,
    isSuperAdmin: false,
    isOwner: false,
    isOwnerIdentity: false,
    subscription: null
  };
}

