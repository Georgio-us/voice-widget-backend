import express from 'express';
import {
  createEstateCrmSelection,
  getEstateCrmSelectionByToken,
  getEstateCrmSelectionEventContext,
  enqueueEstateCrmEvent,
  isEstateCrmIntegrationEnabled,
  listEstateCrmProperties,
  revokeEstateCrmSelection,
  verifyEstateCrmRequest
} from '../services/estateCrmIntegrationService.js';
import { readTelegramIdentityFromRequest } from '../services/telegramInitDataService.js';

const router = express.Router();

const clientEventTypes = new Set(['selection.opened', 'property.viewed', 'telegram.identity_seen', 'session.completed_summary']);

// Browser-side VIA events are authenticated with Telegram WebApp init data,
// then converted into the same server-owned, signed CRM outbox envelope.
router.post('/v1/client-events', async (req, res) => {
  try {
    if (!isEstateCrmIntegrationEnabled()) return res.status(404).json({ code: 'INTEGRATION_DISABLED' });
    const identity = readTelegramIdentityFromRequest(req);
    if (!identity?.verified?.ok) return res.status(401).json({ code: identity?.verified?.code || 'TELEGRAM_INITDATA_REQUIRED' });
    const type = String(req.body?.type || '').trim();
    if (!clientEventTypes.has(type)) return res.status(400).json({ code: 'CLIENT_EVENT_TYPE_INVALID' });
    const selection = await getEstateCrmSelectionEventContext(req.body?.selectionId);
    if (req.body?.selectionId && !selection) return res.status(404).json({ code: 'SELECTION_NOT_FOUND_OR_REVOKED' });
    const propertyExternalId = String(req.body?.propertyExternalId || '').trim().slice(0, 120);
    const sessionId = String(req.body?.sessionId || '').trim().slice(0, 120);
    const summary = String(req.body?.summary || '').trim().slice(0, 1000);
    await enqueueEstateCrmEvent({
      type,
      ...(selection || {}),
      telegram: {
        userId: String(identity.verified.tgUserId),
        ...(identity.verified.user?.username ? { username: String(identity.verified.user.username).slice(0, 120) } : {}),
        ...(identity.verified.user?.first_name ? { firstName: String(identity.verified.user.first_name).slice(0, 120) } : {}),
        ...(identity.verified.user?.last_name ? { lastName: String(identity.verified.user.last_name).slice(0, 120) } : {})
      },
      ...(propertyExternalId ? { propertyExternalId } : {}),
      ...(sessionId ? { session: { sessionId, ...(summary ? { summary } : {}) } } : {})
    });
    return res.json({ ok: true });
  } catch (error) {
    console.warn('[estate-crm] client event enqueue failed:', error?.message || error);
    return res.status(500).json({ code: 'CLIENT_EVENT_ENQUEUE_FAILED' });
  }
});

// This route is deliberately public: the opaque token is the only capability
// exposed in a client-facing selection link. It never returns CRM contact/deal data.
router.get('/v1/public/selections/:token', async (req, res) => {
  try {
    if (!isEstateCrmIntegrationEnabled()) return res.status(404).json({ code: 'INTEGRATION_DISABLED' });
    const selection = await getEstateCrmSelectionByToken(req.params.token);
    if (!selection) return res.status(404).json({ code: 'SELECTION_NOT_FOUND_OR_REVOKED' });
    return res.json(selection);
  } catch {
    return res.status(500).json({ code: 'SELECTION_RESOLVE_FAILED' });
  }
});

const requireCrm = async (req, res, next) => {
  try {
    if (!isEstateCrmIntegrationEnabled()) return res.status(404).json({ code: 'INTEGRATION_DISABLED' });
    const verified = await verifyEstateCrmRequest(req);
    if (!verified.ok) return res.status(401).json({ code: verified.code });
    req.estateCrmConnection = verified.connection;
    next();
  } catch (error) { return res.status(401).json({ code: 'INTEGRATION_AUTH_FAILED' }); }
};

router.get('/v1/properties', requireCrm, async (req, res) => {
  try {
    const result = await listEstateCrmProperties({ cursor: req.query.cursor, updatedSince: req.query.updatedSince, limit: req.query.limit });
    return res.json(result);
  } catch { return res.status(500).json({ code: 'PROPERTIES_EXPORT_FAILED' }); }
});

router.post('/v1/selections', requireCrm, async (req, res) => {
  try {
    const base = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
    // A CRM manager must always receive a usable customer-facing link. Check
    // this before inserting the selection so a misconfigured deployment does
    // not leave an unusable, orphaned selection in the VIA database.
    if (!base) return res.status(503).json({ code: 'VIA_FRONTEND_URL_NOT_CONFIGURED' });
    const result = await createEstateCrmSelection({
      externalSelectionId: req.body?.externalSelectionId, crmContextId: req.body?.crmContextId,
      propertyExternalIds: req.body?.propertyExternalIds, idempotencyKey: req.headers['idempotency-key'],
      allowPartial: req.body?.allowPartial === true
    });
    return res.status(result.duplicate ? 200 : 201).json({ ...result, shareUrl: `${base}/s/s/${result.token}` });
  } catch (error) {
    if (error?.unavailablePropertyExternalIds) return res.status(409).json({ code: error.message, unavailablePropertyExternalIds: error.unavailablePropertyExternalIds });
    return res.status(400).json({ code: error?.message || 'SELECTION_CREATE_FAILED' });
  }
});

router.post('/v1/selections/:selectionId/revoke', requireCrm, async (req, res) => {
  try {
    const revoked = await revokeEstateCrmSelection(req.params.selectionId);
    if (!revoked) return res.status(404).json({ code: 'SELECTION_NOT_FOUND_OR_REVOKED' });
    return res.json({ revokedAt: revoked.revoked_at });
  } catch { return res.status(500).json({ code: 'SELECTION_REVOKE_FAILED' }); }
});

export default router;
