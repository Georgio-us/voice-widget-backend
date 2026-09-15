import crypto from 'node:crypto';
import { pool } from './db.js';

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const tenant = () => text(process.env.CLIENT_ID, 120);
const baseUrl = () => text(process.env.ESTATE_CRM_API_BASE_URL, 500).replace(/\/+$/, '');

export const isEstateCrmIntegrationEnabled = () => truthy(process.env.ESTATE_CRM_INTEGRATION_ENABLED);

const encryptionKey = () => {
  const secret = text(process.env.ESTATE_CRM_INTEGRATION_ENCRYPTION_KEY, 1000);
  if (!secret) throw new Error('ESTATE_CRM_INTEGRATION_ENCRYPTION_KEY_REQUIRED');
  return crypto.createHash('sha256').update(secret).digest();
};

const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
};

const decrypt = (sealed) => {
  const [ivRaw, tagRaw, bodyRaw] = String(sealed || '').split('.');
  if (!ivRaw || !tagRaw || !bodyRaw) throw new Error('ESTATE_CRM_CREDENTIAL_CORRUPTED');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyRaw, 'base64url')), decipher.final()]).toString('utf8');
};

const timingSafeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const canonicalSignatureInput = ({ timestamp, connectionId, method, pathname, search = '', rawBody = '' }) => {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  return `${timestamp}\n${connectionId}\n${String(method).toUpperCase()}\n${pathname}${search}\n${bodyHash}`;
};

export const signIntegrationRequest = ({ credential, timestamp, connectionId, method, pathname, search, rawBody }) =>
  crypto.createHmac('sha256', credential)
    .update(canonicalSignatureInput({ timestamp, connectionId, method, pathname, search, rawBody }))
    .digest('base64url');

export async function getActiveEstateCrmConnection() {
  if (!isEstateCrmIntegrationEnabled() || !tenant()) return null;
  const { rows } = await pool.query(
    `SELECT * FROM estate_crm_connections WHERE client_id = $1 AND status = 'active' LIMIT 1`,
    [tenant()]
  );
  return rows[0] || null;
}

export async function verifyEstateCrmRequest(req) {
  const connectionId = text(req.headers['x-integration-connection'], 200);
  const timestamp = text(req.headers['x-integration-timestamp'], 40);
  const signature = text(req.headers['x-integration-signature'], 500);
  if (!connectionId || !timestamp || !signature) return { ok: false, code: 'INTEGRATION_AUTH_REQUIRED' };
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis) || Math.abs(Date.now() - millis) > 5 * 60 * 1000) return { ok: false, code: 'INTEGRATION_TIMESTAMP_INVALID' };
  const connection = await getActiveEstateCrmConnection();
  if (!connection || connection.crm_connection_id !== connectionId) return { ok: false, code: 'INTEGRATION_CONNECTION_INVALID' };
  const credential = decrypt(connection.encrypted_shared_credential);
  const requestUrl = new URL(req.originalUrl, 'http://local');
  const expected = signIntegrationRequest({
    credential, timestamp, connectionId, method: req.method,
    pathname: requestUrl.pathname, search: requestUrl.search,
    rawBody: req.rawBody || ''
  });
  return timingSafeEqual(expected, signature) ? { ok: true, connection, credential } : { ok: false, code: 'INTEGRATION_SIGNATURE_INVALID' };
}

export async function claimEstateCrmPairing(pairingCode) {
  if (!isEstateCrmIntegrationEnabled()) throw new Error('ESTATE_CRM_INTEGRATION_DISABLED');
  if (!baseUrl()) throw new Error('ESTATE_CRM_API_BASE_URL_REQUIRED');
  const code = text(pairingCode, 1000);
  if (code.length < 24) throw new Error('PAIRING_CODE_INVALID');
  const response = await fetch(`${baseUrl()}/api/integrations/via/pairing/claim`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: code, viaTenant: tenant() })
  });
  if (!response.ok) throw new Error(`PAIRING_CLAIM_FAILED_${response.status}`);
  const payload = await response.json();
  const connectionId = text(payload?.connectionId, 200);
  const credential = text(payload?.sharedCredential || payload?.outboundCredential, 2000);
  if (!connectionId || !credential) throw new Error('PAIRING_RESPONSE_INVALID');
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO estate_crm_connections (id, client_id, crm_connection_id, crm_api_base_url, encrypted_shared_credential)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (client_id) DO UPDATE SET crm_connection_id=EXCLUDED.crm_connection_id, crm_api_base_url=EXCLUDED.crm_api_base_url,
       encrypted_shared_credential=EXCLUDED.encrypted_shared_credential, status='active', disabled_at=NULL, last_error=NULL, updated_at=NOW()`,
    [id, tenant(), connectionId, baseUrl(), encrypt(credential)]
  );
  return { connectionId, status: 'active' };
}

export async function listEstateCrmProperties({ cursor = '', updatedSince = '', limit = 100 } = {}) {
  const values = [tenant()];
  const clauses = ['client_id = $1', 'is_active = true'];
  if (updatedSince) { values.push(updatedSince); clauses.push(`updated_at > $${values.length}::timestamptz`); }
  if (cursor) { values.push(cursor); clauses.push(`external_id > $${values.length}`); }
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
  values.push(safeLimit);
  const { rows } = await pool.query(
    `SELECT external_id, updated_at, title, operation, property_type, price_amount, price_currency,
       specs_rooms, specs_area_m2, location_district, images
     FROM properties WHERE ${clauses.join(' AND ')} ORDER BY external_id ASC LIMIT $${values.length}`,
    values
  );
  const items = rows.map((row) => ({
    externalId: row.external_id, updatedAt: row.updated_at, title: row.title || '', operation: row.operation || '',
    propertyType: row.property_type || '', active: true, price: row.price_amount, currency: row.price_currency || '',
    rooms: row.specs_rooms, areaM2: row.specs_area_m2, district: row.location_district || '', previewImageUrl: Array.isArray(row.images) ? row.images[0] || null : null
  }));
  return { items, nextCursor: items.length === safeLimit ? items.at(-1)?.externalId || null : null };
}

export async function getEstateCrmSelectionByToken(opaqueToken) {
  const token = text(opaqueToken, 300);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.status, array_agg(i.external_id ORDER BY i.created_at) AS external_ids
       FROM estate_crm_selections s
       JOIN estate_crm_selection_items i ON i.selection_id = s.id
      WHERE s.client_id = $1 AND s.opaque_token = $2
      GROUP BY s.id, s.status`,
    [tenant(), token]
  );
  const selection = rows[0] || null;
  if (!selection || selection.status !== 'active') return null;
  const { rows: activeRows } = await pool.query(
    `SELECT external_id FROM properties
      WHERE client_id = $1 AND is_active = true AND external_id = ANY($2::text[])`,
    [tenant(), selection.external_ids || []]
  );
  const activeById = new Set(activeRows.map((row) => row.external_id));
  return {
    selectionId: selection.id,
    propertyExternalIds: (selection.external_ids || []).filter((id) => activeById.has(id))
  };
}

export async function getEstateCrmIntegrationStatus() {
  const connection = await getActiveEstateCrmConnection();
  return {
    enabled: isEstateCrmIntegrationEnabled(),
    connected: Boolean(connection),
    connectionId: connection?.crm_connection_id || null,
    pairedAt: connection?.paired_at || null
  };
}

export async function disconnectEstateCrm() {
  const { rows } = await pool.query(
    `UPDATE estate_crm_connections
        SET status = 'disabled', disabled_at = NOW(), updated_at = NOW()
      WHERE client_id = $1 AND status = 'active'
      RETURNING disabled_at`,
    [tenant()]
  );
  return rows[0] || null;
}

export async function createEstateCrmSelection({ externalSelectionId, crmContextId, propertyExternalIds, idempotencyKey, allowPartial = false }) {
  const ids = Array.from(new Set((Array.isArray(propertyExternalIds) ? propertyExternalIds : []).map((v) => text(v, 120).toUpperCase()).filter(Boolean)));
  if (!ids.length || ids.length > 10) throw new Error('SELECTION_ITEMS_INVALID');
  if (!/^[0-9a-f-]{36}$/i.test(text(externalSelectionId)) || !/^[0-9a-f-]{36}$/i.test(text(crmContextId))) throw new Error('CRM_SELECTION_CONTEXT_INVALID');
  if (!text(idempotencyKey, 250)) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  const connection = await getActiveEstateCrmConnection();
  if (!connection) throw new Error('ESTATE_CRM_CONNECTION_REQUIRED');
  const existing = await pool.query(`SELECT id, opaque_token, status FROM estate_crm_selections WHERE client_id=$1 AND idempotency_key=$2`, [tenant(), text(idempotencyKey, 250)]);
  if (existing.rows[0]) return { selectionId: existing.rows[0].id, token: existing.rows[0].opaque_token, status: existing.rows[0].status, duplicate: true };
  const found = await pool.query(`SELECT external_id FROM properties WHERE client_id=$1 AND is_active=true AND UPPER(TRIM(external_id)) = ANY($2::text[])`, [tenant(), ids]);
  const active = found.rows.map((row) => String(row.external_id).toUpperCase());
  const unavailable = ids.filter((id) => !active.includes(id));
  if (unavailable.length && !allowPartial) {
    const error = new Error('SELECTION_CONTAINS_UNAVAILABLE_PROPERTIES'); error.unavailablePropertyExternalIds = unavailable; throw error;
  }
  if (!active.length) throw new Error('SELECTION_NO_AVAILABLE_PROPERTIES');
  const selectionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO estate_crm_selections (id,client_id,crm_connection_id,crm_external_selection_id,crm_context_id,opaque_token,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [selectionId, tenant(), connection.crm_connection_id, externalSelectionId, crmContextId, token, text(idempotencyKey, 250)]);
    for (const externalId of active) await client.query(`INSERT INTO estate_crm_selection_items (selection_id,external_id) VALUES ($1,$2)`, [selectionId, externalId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  return { selectionId, token, acceptedPropertyExternalIds: active, unavailablePropertyExternalIds: unavailable, duplicate: false };
}

export async function revokeEstateCrmSelection(selectionId) {
  const { rows } = await pool.query(`UPDATE estate_crm_selections SET status='revoked', revoked_at=NOW(), updated_at=NOW() WHERE id=$1 AND client_id=$2 AND status='active' RETURNING revoked_at`, [text(selectionId, 100), tenant()]);
  return rows[0] || null;
}
