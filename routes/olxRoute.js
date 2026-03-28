import express from 'express';
import {
  buildFrontendRedirect,
  buildOlxAuthorizeUrl,
  exchangeCodeForTokens,
  isAdminTgUser,
  resolveClientId,
  verifyStateToken
} from '../services/olxOAuthService.js';
import {
  getOlxIntegrationStatus,
  upsertOlxIntegration
} from '../services/olxIntegrationRepository.js';

const router = express.Router();

const normalize = (value) => String(value || '').trim();

const pickOlxUserId = (payload = {}) =>
  normalize(
    payload?.user_id ||
    payload?.account_id ||
    payload?.advertiser_id ||
    payload?.olx_user_id
  ) || null;

router.get('/connect', async (req, res) => {
  try {
    const tgUserId = normalize(req.query?.tgUserId);
    if (!isAdminTgUser(tgUserId)) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Only owner/super-admin can connect OLX'
      });
    }

    const clientId = resolveClientId(req.query?.clientId);
    const returnTo = normalize(req.query?.returnTo);
    const authorizeUrl = buildOlxAuthorizeUrl({
      clientId,
      tgUserId,
      returnTo
    });
    return res.redirect(authorizeUrl);
  } catch (error) {
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

  if (!isAdminTgUser(tgUserId)) {
    const redirectUrl = buildFrontendRedirect({
      returnTo,
      status: 'failed',
      reason: 'forbidden'
    });
    return res.redirect(redirectUrl);
  }

  try {
    const code = normalize(req.query?.code);
    const tokenPayload = await exchangeCodeForTokens(code);
    const accessToken = normalize(tokenPayload?.access_token);
    if (!accessToken) {
      throw new Error('MISSING_ACCESS_TOKEN_IN_RESPONSE');
    }

    await upsertOlxIntegration({
      clientId,
      tgUserId,
      olxUserId: pickOlxUserId(tokenPayload),
      accessToken,
      refreshToken: normalize(tokenPayload?.refresh_token),
      tokenType: normalize(tokenPayload?.token_type),
      scope: normalize(tokenPayload?.scope),
      expiresIn: tokenPayload?.expires_in,
      rawTokenPayload: tokenPayload
    });

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

router.get('/status', async (req, res) => {
  try {
    const tgUserId = normalize(req.query?.tgUserId);
    if (!isAdminTgUser(tgUserId)) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN'
      });
    }
    const clientId = resolveClientId(req.query?.clientId);
    const status = await getOlxIntegrationStatus({ clientId, tgUserId });
    return res.json({
      ok: true,
      ...status
    });
  } catch (error) {
    console.error('❌ /api/olx/status error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR'
    });
  }
});

export default router;
