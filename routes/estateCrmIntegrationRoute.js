import express from 'express';
import {
  createEstateCrmSelection,
  getEstateCrmSelectionByToken,
  isEstateCrmIntegrationEnabled,
  listEstateCrmProperties,
  revokeEstateCrmSelection,
  verifyEstateCrmRequest
} from '../services/estateCrmIntegrationService.js';

const router = express.Router();

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
    const result = await createEstateCrmSelection({
      externalSelectionId: req.body?.externalSelectionId, crmContextId: req.body?.crmContextId,
      propertyExternalIds: req.body?.propertyExternalIds, idempotencyKey: req.headers['idempotency-key'],
      allowPartial: req.body?.allowPartial === true
    });
    const base = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
    return res.status(result.duplicate ? 200 : 201).json({ ...result, shareUrl: base ? `${base}/s/s/${result.token}` : null });
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
