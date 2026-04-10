import crypto from 'crypto';
import { pool } from './db.js';

const normalizeId = (value) => String(value || '').trim();

const PLAN_DURATION = {
  trial_7: 7,
  month_30: 30,
  year_365: 365,
  lifetime: 0
};
const SUPPORTED_PLANS = ['trial_7', 'month_30', 'year_365', 'lifetime'];

export function hashActivationKey(rawKey) {
  const key = String(rawKey || '').trim();
  const pepper = String(process.env.SUBSCRIPTION_KEY_PEPPER || '').trim();
  if (!key) throw new Error('ACTIVATION_KEY_REQUIRED');
  if (!pepper) throw new Error('SUBSCRIPTION_KEY_PEPPER_REQUIRED');
  return crypto.createHash('sha256').update(`${pepper}:${key}`, 'utf8').digest('hex');
}

function randomChunk(len = 4) {
  return crypto
    .randomBytes(Math.max(1, Math.ceil(len / 2)))
    .toString('hex')
    .slice(0, len)
    .toUpperCase();
}

export function generateActivationKey() {
  return `VIA-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}

export async function createActivationKey({
  plan = 'trial_7',
  durationDays = null,
  maxRedemptions = 1,
  validFrom = null,
  validUntil = null,
  issuedToTgId = null,
  issuedByTgId = null
} = {}) {
  const safePlan = String(plan || '').trim().toLowerCase();
  if (!SUPPORTED_PLANS.includes(safePlan)) {
    throw new Error('INVALID_PLAN');
  }
  const resolvedDuration =
    durationDays == null
      ? PLAN_DURATION[safePlan]
      : Math.max(0, Number.parseInt(String(durationDays), 10) || 0);
  const safeMaxRedemptions = Math.max(1, Number.parseInt(String(maxRedemptions), 10) || 1);
  const key = generateActivationKey();
  const keyHash = hashActivationKey(key);
  const keyLast4 = key.slice(-4);
  const issuedTo = normalizeId(issuedToTgId) || null;
  const issuedBy = normalizeId(issuedByTgId) || null;
  const from = validFrom ? new Date(validFrom) : null;
  const until = validUntil ? new Date(validUntil) : null;
  if (from && Number.isNaN(from.getTime())) throw new Error('INVALID_VALID_FROM');
  if (until && Number.isNaN(until.getTime())) throw new Error('INVALID_VALID_UNTIL');
  if (from && until && until <= from) throw new Error('INVALID_VALID_RANGE');

  const { rows } = await pool.query(
    `
      INSERT INTO license_keys (
        key_hash,
        key_last4,
        plan,
        duration_days,
        max_redemptions,
        valid_from,
        valid_until,
        issued_to_tg_id,
        issued_by_tg_id,
        is_enabled
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
      RETURNING id, plan, duration_days, max_redemptions, valid_from, valid_until, issued_to_tg_id, issued_by_tg_id, is_enabled, created_at
    `,
    [keyHash, keyLast4, safePlan, resolvedDuration, safeMaxRedemptions, from, until, issuedTo, issuedBy]
  );
  const row = rows?.[0] || null;
  return {
    key,
    keyLast4,
    record: row
  };
}

export async function getActivationKeyStatsByPlan() {
  const defaults = Object.fromEntries(
    SUPPORTED_PLANS.map((plan) => [plan, { generated: 0, used: 0 }])
  );
  const { rows } = await pool.query(
    `
      SELECT
        plan,
        COUNT(*)::int AS generated_count,
        COALESCE(SUM(redemptions_count), 0)::int AS used_count
      FROM license_keys
      GROUP BY plan
    `
  );
  for (const row of rows || []) {
    const plan = String(row?.plan || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(defaults, plan)) continue;
    defaults[plan] = {
      generated: Number.isFinite(Number(row?.generated_count)) ? Number(row.generated_count) : 0,
      used: Number.isFinite(Number(row?.used_count)) ? Number(row.used_count) : 0
    };
  }
  return defaults;
}

export async function redeemActivationKey({ activationKey, ownerTgId, activatedByTgId = null } = {}) {
  const ownerId = normalizeId(ownerTgId);
  const actorId = normalizeId(activatedByTgId) || ownerId || null;
  if (!ownerId) throw new Error('OWNER_TG_ID_REQUIRED');
  const key = String(activationKey || '').trim();
  if (!key) throw new Error('ACTIVATION_KEY_REQUIRED');
  const keyHash = hashActivationKey(key);
  const now = new Date();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const keyResult = await client.query(
      `
        SELECT *
        FROM license_keys
        WHERE key_hash = $1
        FOR UPDATE
      `,
      [keyHash]
    );
    const keyRow = keyResult.rows?.[0];
    if (!keyRow) throw new Error('KEY_NOT_FOUND');
    if (keyRow.is_enabled !== true) throw new Error('KEY_DISABLED');
    if (keyRow.valid_from && new Date(keyRow.valid_from) > now) throw new Error('KEY_NOT_ACTIVE_YET');
    if (keyRow.valid_until && new Date(keyRow.valid_until) < now) throw new Error('KEY_EXPIRED');
    if (keyRow.issued_to_tg_id && normalizeId(keyRow.issued_to_tg_id) !== ownerId) {
      throw new Error('KEY_ISSUED_TO_OTHER_OWNER');
    }
    if (Number(keyRow.redemptions_count || 0) >= Number(keyRow.max_redemptions || 0)) {
      throw new Error('KEY_REDEMPTIONS_EXHAUSTED');
    }

    await client.query(
      `
        UPDATE owner_subscriptions
        SET status = 'expired', updated_at = NOW()
        WHERE owner_tg_id = $1
          AND status = 'active'
      `,
      [ownerId]
    );

    const startsAt = now;
    const durationDays = Math.max(0, Number.parseInt(String(keyRow.duration_days || 0), 10) || 0);
    const plan = String(keyRow.plan || '').trim().toLowerCase();
    const endsAt = plan === 'lifetime' || durationDays <= 0
      ? null
      : new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const subscriptionInsert = await client.query(
      `
        INSERT INTO owner_subscriptions (
          owner_tg_id,
          plan,
          status,
          starts_at,
          ends_at,
          activation_source,
          activated_by_tg_id,
          note
        )
        VALUES ($1,$2,'active',$3,$4,'key',$5,$6)
        RETURNING id, owner_tg_id, plan, status, starts_at, ends_at, activation_source, activated_by_tg_id, created_at
      `,
      [ownerId, keyRow.plan, startsAt, endsAt, actorId, `redeemed:${String(keyRow.key_last4 || '').trim()}`]
    );
    const subscription = subscriptionInsert.rows?.[0];

    await client.query(
      `
        UPDATE license_keys
        SET
          redemptions_count = redemptions_count + 1,
          is_enabled = CASE WHEN (redemptions_count + 1) >= max_redemptions THEN FALSE ELSE is_enabled END,
          updated_at = NOW()
        WHERE id = $1
      `,
      [keyRow.id]
    );

    await client.query(
      `
        INSERT INTO license_redemptions (
          license_key_id,
          redeemed_by_tg_id,
          redeemed_at,
          subscription_id,
          key_last4,
          request_meta
        )
        VALUES ($1,$2,NOW(),$3,$4,$5::jsonb)
      `,
      [
        keyRow.id,
        ownerId,
        subscription?.id || null,
        String(keyRow.key_last4 || '').trim(),
        JSON.stringify({
          by: actorId,
          source: 'widget'
        })
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      subscription,
      redeemed: {
        keyLast4: String(keyRow.key_last4 || '').trim(),
        plan: keyRow.plan,
        durationDays,
        maxRedemptions: Number(keyRow.max_redemptions || 0)
      }
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
