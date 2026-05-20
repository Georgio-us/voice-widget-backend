import express from 'express';
import crypto from 'crypto';
import {
  buildFrontendRedirect,
  buildOlxAuthorizeUrl,
  exchangeCodeForTokens,
  resolveClientId,
  verifyStateToken
} from '../services/olxOAuthService.js';
import {
  getOlxIntegrationStatus,
  upsertOlxIntegration
} from '../services/olxIntegrationRepository.js';
import {
  clearImportedOlxProperties,
  getOlxImportedStats,
  syncOlxAdvertsForAdmin
} from '../services/olxImportService.js';
import { resolveViewerAccessByTgId } from '../services/viewerAccessService.js';
import { resolveTgUserIdForAccess, toHttpAuthError } from '../services/telegramInitDataService.js';

const router = express.Router();

const normalize = (value) => String(value || '').trim();
const parseBool = (value) => ['1', 'true', 'yes', 'on'].includes(normalize(value).toLowerCase());
const stripSlash = (value) => String(value || '').trim().replace(/\/+$/, '');
const OLX_CONNECT_BASE = stripSlash(process.env.OLX_CONNECT_BASE);
const OLX_HUB_SHARED_SECRET = normalize(process.env.OLX_HUB_SHARED_SECRET);
const HUB_FORWARD_TTL_MS = 5 * 60 * 1000;

const parseClientBackendMap = () => {
  const raw = normalize(process.env.CLIENT_BACKEND_MAP);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [normalize(key), stripSlash(value)])
        .filter(([key, value]) => key && value)
    );
  } catch {
    return {};
  }
};

const CLIENT_BACKEND_MAP = parseClientBackendMap();

const getCurrentServiceBaseFromReq = (req) => {
  try {
    const forwardedProto = normalize(req.headers?.['x-forwarded-proto']);
    const proto = forwardedProto || req.protocol || 'https';
    const host = normalize(req.headers?.['x-forwarded-host'] || req.get?.('host'));
    if (!host) return '';
    return stripSlash(`${proto}://${host}`);
  } catch {
    return '';
  }
};

const isSameBase = (a, b) => {
  const x = stripSlash(a);
  const y = stripSlash(b);
  return !!x && !!y && x.toLowerCase() === y.toLowerCase();
};

const resolveTargetBackendBase = (clientId) => {
  const key = normalize(clientId);
  if (!key) return '';
  return stripSlash(CLIENT_BACKEND_MAP[key] || '');
};

const toHubForwardPayload = ({ clientId, tgUserId, hubTs }) =>
  `${normalize(clientId)}|${normalize(tgUserId)}|${normalize(hubTs)}`;

const createHubForwardSignature = ({ clientId, tgUserId, hubTs }) => {
  if (!OLX_HUB_SHARED_SECRET) return '';
  return crypto
    .createHmac('sha256', OLX_HUB_SHARED_SECRET)
    .update(toHubForwardPayload({ clientId, tgUserId, hubTs }))
    .digest('hex');
};

const safeHexEqual = (a, b) => {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y || x.length !== y.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(x, 'hex'), Buffer.from(y, 'hex'));
  } catch {
    return false;
  }
};

const verifyHubForward = ({ clientId, tgUserId, hubTs, hubSig }) => {
  const tsNum = Number(hubTs);
  if (!OLX_HUB_SHARED_SECRET) return { ok: false, reason: 'HUB_SECRET_MISSING' };
  if (!normalize(clientId) || !normalize(tgUserId) || !Number.isFinite(tsNum)) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  const age = Math.abs(Date.now() - tsNum);
  if (age > HUB_FORWARD_TTL_MS) return { ok: false, reason: 'TS_EXPIRED' };
  const expected = createHubForwardSignature({ clientId, tgUserId, hubTs: String(tsNum) });
  if (!safeHexEqual(expected, hubSig)) return { ok: false, reason: 'BAD_SIG' };
  return { ok: true };
};

const buildHubConnectUrl = ({ clientId, tgUserId, returnTo, initData }) => {
  const hubBase = stripSlash(OLX_CONNECT_BASE);
  if (!hubBase) return '';
  const url = new URL(`${hubBase}/api/olx/connect`);
  if (clientId) url.searchParams.set('clientId', String(clientId));
  if (tgUserId) url.searchParams.set('tgUserId', String(tgUserId));
  if (returnTo) url.searchParams.set('returnTo', String(returnTo));
  if (initData) url.searchParams.set('initData', String(initData));
  if (OLX_HUB_SHARED_SECRET && clientId && tgUserId) {
    const hubTs = String(Date.now());
    const hubSig = createHubForwardSignature({ clientId, tgUserId, hubTs });
    if (hubSig) {
      url.searchParams.set('hubTs', hubTs);
      url.searchParams.set('hubSig', hubSig);
    }
  }
  return url.toString();
};

const handoffOlxTokensToTarget = async ({
  targetBackendBase,
  payload
}) => {
  if (!targetBackendBase) throw new Error('TARGET_BACKEND_BASE_REQUIRED');
  if (!OLX_HUB_SHARED_SECRET) throw new Error('OLX_HUB_SHARED_SECRET_REQUIRED');
  const endpoint = `${stripSlash(targetBackendBase)}/api/olx/link-from-hub`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OLX-HUB-SECRET': OLX_HUB_SHARED_SECRET
    },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const reason = String(data?.error || `HTTP_${response.status}`);
    throw new Error(`OLX_HUB_HANDOFF_FAILED:${reason}`);
  }
  return data;
};

const pickOlxUserId = (payload = {}) =>
  normalize(
    payload?.user_id ||
    payload?.account_id ||
    payload?.advertiser_id ||
    payload?.olx_user_id
  ) || null;

const ensurePaidAdminAccess = async (tgUserId) => {
  const access = await resolveViewerAccessByTgId(tgUserId);
  if (access.isAdmin) return { ok: true, access };
  if (access.isOwnerIdentity === true) {
    return { ok: false, status: 403, body: { ok: false, error: 'SUBSCRIPTION_REQUIRED', subscription: access.subscription || null } };
  }
  return { ok: false, status: 403, body: { ok: false, error: 'FORBIDDEN' } };
};

router.get('/connect', async (req, res) => {
  try {
    const clientId = resolveClientId(req.query?.clientId);
    const returnTo = normalize(req.query?.returnTo);
    const forceReauth = parseBool(req.query?.reauth);
    const initData = normalize(req.query?.initData || req.headers?.['x-telegram-init-data']);
    const forwardedTgUserId = normalize(req.query?.tgUserId);
    const hubTs = normalize(req.query?.hubTs);
    const hubSig = normalize(req.query?.hubSig);
    const hubForward = verifyHubForward({
      clientId,
      tgUserId: forwardedTgUserId,
      hubTs,
      hubSig
    });
    let tgUserId = '';
    let trustedForward = false;
    if (hubForward.ok) {
      tgUserId = forwardedTgUserId;
      trustedForward = true;
    } else {
      const resolved = resolveTgUserIdForAccess(req);
      tgUserId = normalize(resolved?.tgUserId);
      const accessCheck = await ensurePaidAdminAccess(tgUserId);
      if (!accessCheck.ok) return res.status(accessCheck.status).json(accessCheck.body);
    }
    const currentBase = getCurrentServiceBaseFromReq(req);
    if (OLX_CONNECT_BASE && !isSameBase(OLX_CONNECT_BASE, currentBase)) {
      const hubUrl = buildHubConnectUrl({
        clientId,
        tgUserId,
        returnTo,
        initData
      });
      if (hubUrl) {
        return res.redirect(hubUrl);
      }
    }
    const authorizeUrl = buildOlxAuthorizeUrl({
      clientId,
      tgUserId,
      returnTo,
      trustedForward,
      forceReauth
    });
    return res.redirect(authorizeUrl);
  } catch (error) {
    const authError = toHttpAuthError(error);
    if (authError) return res.status(authError.status).json(authError.body);
    console.error('❌ /api/olx/connect error:', error);
    return res.status(500).json({
      ok: false,
      error: 'OLX_CONNECT_INIT_FAILED',
      details: error?.message || 'unknown_error'
    });
  }
});

router.get('/callback', async (req, res) => {
  const olxError = normalize(req.query?.error);
  const olxErrorDescription = normalize(req.query?.error_description);
  const stateRaw = normalize(req.query?.state);

  let statePayload = null;
  try {
    statePayload = verifyStateToken(stateRaw);
  } catch (error) {
    const redirectUrl = buildFrontendRedirect({
      returnTo: '',
      status: 'failed',
      reason: 'state_invalid'
    });
    return res.redirect(redirectUrl);
  }

  const returnTo = statePayload?.returnTo || '';
  const clientId = resolveClientId(statePayload?.clientId);
  const tgUserId = normalize(statePayload?.tgUserId);

  if (olxError) {
    const redirectUrl = buildFrontendRedirect({
      returnTo,
      status: 'failed',
      reason: olxErrorDescription || olxError
    });
    return res.redirect(redirectUrl);
  }

  const trustedForward = Number(statePayload?.hf || 0) === 1;
  if (!trustedForward) {
    const callbackAccess = await ensurePaidAdminAccess(tgUserId);
    if (!callbackAccess.ok) {
      const redirectUrl = buildFrontendRedirect({
        returnTo,
        status: 'failed',
        reason: callbackAccess.body?.error || 'forbidden'
      });
      return res.redirect(redirectUrl);
    }
  }

  try {
    const code = normalize(req.query?.code);
    const tokenPayload = await exchangeCodeForTokens(code);
    const accessToken = normalize(tokenPayload?.access_token);
    if (!accessToken) {
      throw new Error('MISSING_ACCESS_TOKEN_IN_RESPONSE');
    }

    const targetBackendBase = resolveTargetBackendBase(clientId);
    const currentBase = getCurrentServiceBaseFromReq(req);
    const handoffPayload = {
      clientId,
      tgUserId,
      olxUserId: pickOlxUserId(tokenPayload),
      accessToken,
      refreshToken: normalize(tokenPayload?.refresh_token),
      tokenType: normalize(tokenPayload?.token_type),
      scope: normalize(tokenPayload?.scope),
      expiresIn: tokenPayload?.expires_in,
      rawTokenPayload: tokenPayload
    };
    if (targetBackendBase && !isSameBase(targetBackendBase, currentBase)) {
      await handoffOlxTokensToTarget({
        targetBackendBase,
        payload: handoffPayload
      });
    } else {
      await upsertOlxIntegration(handoffPayload);
    }

    const redirectUrl = buildFrontendRedirect({
      returnTo,
      status: 'connected'
    });
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('❌ /api/olx/callback error:', error);
    const redirectUrl = buildFrontendRedirect({
      returnTo,
      status: 'failed',
      reason: 'token_exchange_failed'
    });
    return res.redirect(redirectUrl);
  }
});

router.post('/link-from-hub', async (req, res) => {
  try {
    const incomingSecret = normalize(req.headers?.['x-olx-hub-secret']);
    if (!incomingSecret || !OLX_HUB_SHARED_SECRET || incomingSecret !== OLX_HUB_SHARED_SECRET) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN_HUB_SECRET' });
    }
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const clientId = resolveClientId(payload.clientId);
    const tgUserId = normalize(payload.tgUserId);
    const accessToken = normalize(payload.accessToken);
    if (!tgUserId) return res.status(400).json({ ok: false, error: 'TG_USER_ID_REQUIRED' });
    if (!accessToken) return res.status(400).json({ ok: false, error: 'ACCESS_TOKEN_REQUIRED' });

    const result = await upsertOlxIntegration({
      clientId,
      tgUserId,
      olxUserId: normalize(payload.olxUserId || payload.olx_user_id) || pickOlxUserId(payload),
      accessToken,
      refreshToken: normalize(payload.refreshToken),
      tokenType: normalize(payload.tokenType),
      scope: normalize(payload.scope),
      expiresIn: payload.expiresIn,
      rawTokenPayload: payload.rawTokenPayload && typeof payload.rawTokenPayload === 'object'
        ? payload.rawTokenPayload
        : {}
    });
    return res.json({ ok: true, result });
  } catch (error) {
    console.error('❌ /api/olx/link-from-hub error:', error);
    return res.status(500).json({ ok: false, error: 'OLX_HUB_LINK_FAILED' });
  }
});

router.get('/status', async (req, res) => {
  try {
    const { tgUserId } = resolveTgUserIdForAccess(req);
    const accessCheck = await ensurePaidAdminAccess(tgUserId);
    if (!accessCheck.ok) return res.status(accessCheck.status).json(accessCheck.body);
    const clientId = resolveClientId(req.query?.clientId);
    const status = await getOlxIntegrationStatus({ clientId, tgUserId });
    const imported = await getOlxImportedStats({ clientId });
    return res.json({
      ok: true,
      ...status,
      ...imported
    });
  } catch (error) {
    const authError = toHttpAuthError(error);
    if (authError) return res.status(authError.status).json(authError.body);
    console.error('❌ /api/olx/status error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR'
    });
  }
});

router.post('/clear-imported', async (req, res) => {
  try {
    const { tgUserId } = resolveTgUserIdForAccess(req);
    const accessCheck = await ensurePaidAdminAccess(tgUserId);
    if (!accessCheck.ok) return res.status(accessCheck.status).json(accessCheck.body);
    const clientId = resolveClientId(req.query?.clientId || req.body?.clientId);
    const result = await clearImportedOlxProperties({ clientId });
    const imported = await getOlxImportedStats({ clientId });
    return res.json({
      ok: true,
      clientId,
      ...result,
      ...imported
    });
  } catch (error) {
    const authError = toHttpAuthError(error);
    if (authError) return res.status(authError.status).json(authError.body);
    console.error('❌ /api/olx/clear-imported error:', error);
    return res.status(500).json({
      ok: false,
      error: 'OLX_CLEAR_IMPORTED_FAILED',
      details: String(error?.message || 'unknown_error')
    });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const { tgUserId } = resolveTgUserIdForAccess(req);
    const accessCheck = await ensurePaidAdminAccess(tgUserId);
    if (!accessCheck.ok) return res.status(accessCheck.status).json(accessCheck.body);

    const clientId = resolveClientId(req.query?.clientId || req.body?.clientId);
    const result = await syncOlxAdvertsForAdmin({ clientId, tgUserId });
    return res.json({
      ok: true,
      clientId,
      ...result
    });
  } catch (error) {
    const authError = toHttpAuthError(error);
    if (authError) return res.status(authError.status).json(authError.body);
    console.error('❌ /api/olx/sync error:', error);
    const message = String(error?.message || '');
    if (message === 'OLX_NOT_CONNECTED') {
      return res.status(400).json({
        ok: false,
        error: 'OLX_NOT_CONNECTED'
      });
    }
    if (message.startsWith('OLX_TOKEN_REFRESH_FAILED:') || message === 'MISSING_REFRESH_TOKEN') {
      return res.status(401).json({
        ok: false,
        error: 'OLX_RECONNECT_REQUIRED',
        details: message || 'refresh_token_expired'
      });
    }
    return res.status(500).json({
      ok: false,
      error: 'OLX_SYNC_FAILED',
      details: message || 'unknown_error'
    });
  }
});

export default router;
