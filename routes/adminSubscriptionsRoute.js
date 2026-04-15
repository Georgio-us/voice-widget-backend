import express from 'express';
import { resolveViewerAccessByTgId } from '../services/viewerAccessService.js';
import { createActivationKey, redeemActivationKey, getActivationKeyStatsByPlan } from '../services/subscriptionService.js';
import { resolveTgUserIdForAccess, toHttpAuthError } from '../services/telegramInitDataService.js';

const router = express.Router();

const normalizeId = (v) => String(v || '').trim();

const requireOwnerOrSuperAdmin = async (req, res, next) => {
  try {
    const { tgUserId } = resolveTgUserIdForAccess(req);
    const access = await resolveViewerAccessByTgId(tgUserId);
    const isDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
    const devAdminFlag = String(req.body?.devAdmin || req.query?.devAdmin || '').trim() === '1';
    if (!access.isOwnerIdentity && !access.isSuperAdmin && isDev && devAdminFlag) {
      req.viewerAccess = { ...access, isOwnerIdentity: true, isAdmin: true, devBypass: true };
      return next();
    }
    if (!access.isOwnerIdentity && !access.isSuperAdmin) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN_OWNER_ONLY' });
    }
    req.viewerAccess = access;
    next();
  } catch (error) {
    const authError = toHttpAuthError(error);
    if (authError) return res.status(authError.status).json(authError.body);
    console.error('❌ requireOwnerOrSuperAdmin failed:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
};

const requireSuperAdmin = async (req, res, next) => {
  try {
    const { tgUserId } = resolveTgUserIdForAccess(req);
    const access = await resolveViewerAccessByTgId(tgUserId);
    const isDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
    const devAdminFlag = String(req.body?.devAdmin || req.query?.devAdmin || '').trim() === '1';
    if (!access.isSuperAdmin && isDev && devAdminFlag) {
      req.viewerAccess = { ...access, isSuperAdmin: true, isAdmin: true, devBypass: true };
      return next();
    }
    if (!access.isSuperAdmin) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN_SUPER_ADMIN_ONLY' });
    }
    req.viewerAccess = access;
    next();
  } catch (error) {
    const authError = toHttpAuthError(error);
    if (authError) return res.status(authError.status).json(authError.body);
    console.error('❌ requireSuperAdmin failed:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
};

router.post('/subscriptions/redeem', requireOwnerOrSuperAdmin, async (req, res) => {
  try {
    const activationKey = String(req.body?.activationKey || '').trim();
    if (!activationKey) {
      return res.status(400).json({ ok: false, error: 'ACTIVATION_KEY_REQUIRED' });
    }
    const actorTgId = normalizeId(req.viewerAccess?.tgUserId);
    const isSuperAdmin = req.viewerAccess?.isSuperAdmin === true;
    const ownerEnvTgId = normalizeId(process.env.OWNER_TG_ID);
    const requestedOwnerTgId = normalizeId(
      req.body?.ownerTgId || req.query?.ownerTgId
    );
    const ownerTgId = isSuperAdmin
      ? (requestedOwnerTgId || ownerEnvTgId)
      : actorTgId;
    if (!ownerTgId) {
      return res.status(400).json({ ok: false, error: 'OWNER_TG_ID_REQUIRED' });
    }
    const result = await redeemActivationKey({
      activationKey,
      ownerTgId,
      activatedByTgId: actorTgId || ownerTgId
    });
    console.log('[SUBSCRIPTION_REDEEM]', {
      isSuperAdmin,
      actorTgId,
      ownerTgId,
      requestedOwnerTgId: requestedOwnerTgId || null,
      ownerEnvTgId: ownerEnvTgId || null
    });
    return res.json({
      ok: true,
      message: 'SUBSCRIPTION_ACTIVATED',
      ownerTgId,
      activatedByTgId: actorTgId || ownerTgId,
      ...result
    });
  } catch (error) {
    const code = String(error?.message || 'INTERNAL_SERVER_ERROR');
    if (
      code === 'ACTIVATION_KEY_REQUIRED' ||
      code === 'OWNER_TG_ID_REQUIRED'
    ) return res.status(400).json({ ok: false, error: code });
    if (
      code === 'KEY_NOT_FOUND' ||
      code === 'KEY_DISABLED' ||
      code === 'KEY_NOT_ACTIVE_YET' ||
      code === 'KEY_EXPIRED' ||
      code === 'KEY_ISSUED_TO_OTHER_OWNER' ||
      code === 'KEY_REDEMPTIONS_EXHAUSTED'
    ) return res.status(409).json({ ok: false, error: code });
    if (code === 'SUBSCRIPTION_KEY_PEPPER_REQUIRED') return res.status(500).json({ ok: false, error: code });
    console.error('❌ POST /api/admin/subscriptions/redeem error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.post('/subscriptions/keys/create', requireSuperAdmin, async (req, res) => {
  try {
    const payload = {
      plan: req.body?.plan,
      durationDays: req.body?.durationDays,
      maxRedemptions: req.body?.maxRedemptions,
      validFrom: req.body?.validFrom,
      validUntil: req.body?.validUntil,
      issuedToTgId: req.body?.issuedToTgId,
      issuedByTgId: normalizeId(req.viewerAccess?.tgUserId)
    };
    const created = await createActivationKey(payload);
    return res.status(201).json({
      ok: true,
      activationKey: created.key,
      keyLast4: created.keyLast4,
      record: created.record
    });
  } catch (error) {
    const code = String(error?.message || 'INTERNAL_SERVER_ERROR');
    if (
      code === 'INVALID_PLAN' ||
      code === 'INVALID_VALID_FROM' ||
      code === 'INVALID_VALID_UNTIL' ||
      code === 'INVALID_VALID_RANGE'
    ) return res.status(400).json({ ok: false, error: code });
    if (code === 'SUBSCRIPTION_KEY_PEPPER_REQUIRED') return res.status(500).json({ ok: false, error: code });
    console.error('❌ POST /api/admin/subscriptions/keys/create error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.get('/subscriptions/keys/stats', requireSuperAdmin, async (req, res) => {
  try {
    const stats = await getActivationKeyStatsByPlan();
    return res.json({ ok: true, stats });
  } catch (error) {
    console.error('❌ GET /api/admin/subscriptions/keys/stats error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

export default router;
