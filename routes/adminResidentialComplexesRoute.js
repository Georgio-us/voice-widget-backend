import express from 'express';
import {
  listResidentialComplexes,
  insertResidentialComplex,
  deleteResidentialComplex
} from '../services/residentialComplexesRepository.js';
import { resolveViewerAccessByTgId } from '../services/viewerAccessService.js';
import { resolveTgUserIdForAccess, toHttpAuthError } from '../services/telegramInitDataService.js';

const router = express.Router();

const SERVICE_CLIENT_ID = String(process.env.CLIENT_ID || '').trim();

const normalizeId = (v) => String(v || '').trim();

const requireAdmin = async (req, res, next) => {
  try {
    const { tgUserId } = resolveTgUserIdForAccess(req);
    const access = await resolveViewerAccessByTgId(tgUserId);
    const isDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
    const devAdminFlag = String(req.body?.devAdmin || req.query?.devAdmin || '').trim() === '1';
    if (!access.isAdmin && isDev && devAdminFlag) {
      req.viewerAccess = { ...access, isAdmin: true, devBypass: true };
      return next();
    }
    if (!access.isAdmin) {
      if (access.isOwnerIdentity === true) {
        return res.status(403).json({
          ok: false,
          error: 'SUBSCRIPTION_REQUIRED',
          subscription: access.subscription || null
        });
      }
      return res.status(403).json({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });
    }
    req.viewerAccess = access;
    next();
  } catch (error) {
    const authError = toHttpAuthError(error);
    if (authError) return res.status(authError.status).json(authError.body);
    console.error('❌ requireAdmin access check failed:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
};

router.get('/residential-complexes', requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    }
    const q = String(req.query?.q ?? '').trim();
    const lang = String(req.query?.lang ?? 'ua').trim().toLowerCase().slice(0, 2) === 'ru' ? 'ru' : 'ua';
    const limitRaw = Number.parseInt(String(req.query?.limit ?? '50').trim(), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const items = await listResidentialComplexes(SERVICE_CLIENT_ID, { q, limit, lang });
    return res.json({ ok: true, items });
  } catch (error) {
    console.error('GET /api/admin/residential-complexes:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.post('/residential-complexes', requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    }
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: 'NAME_REQUIRED' });
    }
    const tgFromAccess = req.viewerAccess?.tgUserId;
    const createdBy = normalizeId(tgFromAccess) || null;

    const { item, existed } = await insertResidentialComplex(
      SERVICE_CLIENT_ID,
      name,
      createdBy
    );
    return res.status(existed ? 200 : 201).json({ ok: true, item, existed });
  } catch (error) {
    const msg = String(error?.message || '');
    if (msg === 'NAME_REQUIRED') {
      return res.status(400).json({ ok: false, error: 'NAME_REQUIRED' });
    }
    if (msg === 'NAME_TOO_LONG') {
      return res.status(400).json({ ok: false, error: 'NAME_TOO_LONG' });
    }
    console.error('POST /api/admin/residential-complexes:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.delete('/residential-complexes/:id', requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    }
    const idRaw = String(req.params?.id ?? '').trim();
    const { deleted } = await deleteResidentialComplex(SERVICE_CLIENT_ID, idRaw);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    return res.json({ ok: true, deleted: true });
  } catch (error) {
    const msg = String(error?.message || '');
    if (msg === 'INVALID_ID') {
      return res.status(400).json({ ok: false, error: 'INVALID_ID' });
    }
    console.error('DELETE /api/admin/residential-complexes/:id:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

export default router;
