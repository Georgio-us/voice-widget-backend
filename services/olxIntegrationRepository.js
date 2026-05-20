import { pool } from './db.js';

const DEFAULT_CLIENT_ID = 'demo';

function normalizeClientId(value) {
  const normalized = String(value || '').trim();
  return normalized || DEFAULT_CLIENT_ID;
}

function normalizeTgUserId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeExpiresAt(expiresInSeconds) {
  const seconds = Number(expiresInSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + (seconds * 1000));
}

export async function upsertOlxIntegration({
  clientId = DEFAULT_CLIENT_ID,
  tgUserId,
  olxUserId = null,
  accessToken,
  refreshToken = null,
  tokenType = null,
  scope = null,
  expiresIn = null,
  rawTokenPayload = null
}) {
  const resolvedClientId = normalizeClientId(clientId);
  const normalizedTgUserId = normalizeTgUserId(tgUserId);
  const normalizedAccessToken = String(accessToken || '').trim();

  if (!normalizedTgUserId) {
    throw new Error('INVALID_TG_USER_ID');
  }
  if (!normalizedAccessToken) {
    throw new Error('MISSING_ACCESS_TOKEN');
  }

  const normalizedRefreshToken = String(refreshToken || '').trim() || null;
  const normalizedTokenType = String(tokenType || '').trim() || null;
  const normalizedScope = String(scope || '').trim() || null;
  const normalizedOlxUserId = String(olxUserId || '').trim() || null;
  const expiresAt = computeExpiresAt(expiresIn);
  const payload = rawTokenPayload && typeof rawTokenPayload === 'object' ? rawTokenPayload : {};

  try {
    const result = await pool.query(
      `
      INSERT INTO olx_integrations (
        client_id,
        tg_user_id,
        olx_user_id,
        access_token,
        refresh_token,
        token_type,
        scope,
        expires_at,
        raw_token_payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      ON CONFLICT (client_id, tg_user_id) DO UPDATE
      SET
        olx_user_id = EXCLUDED.olx_user_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_type = EXCLUDED.token_type,
        scope = EXCLUDED.scope,
        expires_at = EXCLUDED.expires_at,
        raw_token_payload = EXCLUDED.raw_token_payload,
        updated_at = NOW()
      RETURNING
        id,
        client_id,
        tg_user_id,
        olx_user_id,
        scope,
        expires_at,
        updated_at
      `,
      [
        resolvedClientId,
        normalizedTgUserId,
        normalizedOlxUserId,
        normalizedAccessToken,
        normalizedRefreshToken,
        normalizedTokenType,
        normalizedScope,
        expiresAt,
        JSON.stringify(payload)
      ]
    );
    return result.rows?.[0] || null;
  } catch (error) {
    // relation does not exist
    if (error?.code === '42P01') {
      throw new Error('OLX_TABLE_MISSING');
    }
    throw error;
  }
}

export async function getOlxIntegrationStatus({
  clientId = DEFAULT_CLIENT_ID,
  tgUserId
}) {
  const resolvedClientId = normalizeClientId(clientId);
  const normalizedTgUserId = normalizeTgUserId(tgUserId);
  if (!normalizedTgUserId) {
    return { connected: false };
  }

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        client_id,
        tg_user_id,
        olx_user_id,
        scope,
        expires_at,
        updated_at
      FROM olx_integrations
      WHERE client_id = $1
        AND tg_user_id = $2
      LIMIT 1
      `,
      [resolvedClientId, normalizedTgUserId]
    );
    const row = result.rows?.[0] || null;
    if (!row) return { connected: false };
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    const expired = expiresAt instanceof Date
      && Number.isFinite(expiresAt.getTime())
      && expiresAt.getTime() <= Date.now();
    if (expired) {
      return {
        connected: false,
        reconnectRequired: true,
        reason: 'token_expired',
        previouslyConnected: true,
        olxUserId: row.olx_user_id || null,
        scope: row.scope || null,
        expiresAt: row.expires_at || null,
        updatedAt: row.updated_at || null
      };
    }
    return {
      connected: true,
      reconnectRequired: false,
      olxUserId: row.olx_user_id || null,
      scope: row.scope || null,
      expiresAt: row.expires_at || null,
      updatedAt: row.updated_at || null
    };
  } catch (error) {
    if (error?.code === '42P01') {
      return { connected: false, tableMissing: true };
    }
    throw error;
  }
}

export async function getOlxIntegrationCredentials({
  clientId = DEFAULT_CLIENT_ID,
  tgUserId
}) {
  const resolvedClientId = normalizeClientId(clientId);
  const normalizedTgUserId = normalizeTgUserId(tgUserId);
  if (!normalizedTgUserId) return null;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        client_id,
        tg_user_id,
        olx_user_id,
        access_token,
        refresh_token,
        token_type,
        scope,
        expires_at,
        updated_at
      FROM olx_integrations
      WHERE client_id = $1
        AND tg_user_id = $2
      LIMIT 1
      `,
      [resolvedClientId, normalizedTgUserId]
    );
    return result.rows?.[0] || null;
  } catch (error) {
    if (error?.code === '42P01') return null;
    throw error;
  }
}
