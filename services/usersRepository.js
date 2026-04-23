import { pool } from './db.js';

const DEFAULT_CLIENT_ID = 'demo';

/**
 * Upsert Telegram user into users table.
 * Safe-by-design:
 * - if table does not exist yet (42P01), function exits silently (best-effort),
 *   so rollout can happen before manual DDL apply.
 */
export async function upsertTelegramUser({
  clientId = DEFAULT_CLIENT_ID,
  tgUserId,
  username = null,
  firstName = null,
  lastName = null,
  languageCode = null,
  meta = null
}) {
  const tgId = Number(tgUserId);
  if (!Number.isFinite(tgId)) return { ok: false, skipped: true, reason: 'invalid_tg_user_id' };

  const normalizedMeta =
    meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO users (
        client_id,
        tg_user_id,
        username,
        first_name,
        last_name,
        language_code,
        first_seen_at,
        last_seen_at,
        meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7::jsonb)
      ON CONFLICT (client_id, tg_user_id) DO UPDATE
      SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        last_seen_at = NOW(),
        meta = COALESCE(users.meta, '{}'::jsonb) || COALESCE(EXCLUDED.meta, '{}'::jsonb)
      RETURNING (xmax = 0) AS inserted
      `,
      [
        String(clientId || DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID,
        tgId,
        username ? String(username).trim() : null,
        firstName ? String(firstName).trim() : null,
        lastName ? String(lastName).trim() : null,
        languageCode ? String(languageCode).trim() : null,
        JSON.stringify(normalizedMeta)
      ]
    );
    return { ok: true, skipped: false, isNew: rows?.[0]?.inserted === true };
  } catch (err) {
    // relation does not exist (manual DDL not applied yet)
    if (err?.code === '42P01') {
      return { ok: false, skipped: true, reason: 'users_table_missing' };
    }
    throw err;
  }
}
