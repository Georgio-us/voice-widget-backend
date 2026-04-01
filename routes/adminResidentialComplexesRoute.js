import express from 'express';
import {
  listResidentialComplexes,
  insertResidentialComplex
} from '../services/residentialComplexesRepository.js';

const router = express.Router();

const SERVICE_CLIENT_ID = String(process.env.CLIENT_ID || '').trim();

const normalizeId = (v) => String(v || '').trim();
const resolveAccess = (tgUserIdRaw) => {
  const tgUserId = normalizeId(tgUserIdRaw);
  const superAdminId = normalizeId(process.env.SUPER_ADMIN_ID);
  const ownerId = normalizeId(process.env.OWNER_TG_ID);
  const isSuperAdmin = !!(tgUserId && superAdminId && tgUserId === superAdminId);
  const isOwner = !!(tgUserId && ownerId && tgUserId === ownerId);
  return {
    tgUserId,
    isAdmin: isSuperAdmin || isOwner,
    isOwner,
    isSuperAdmin
  };
};

const requireAdmin = (req, res, next) => {
  const fromBody = req.body?.tgUserId;
  const fromQuery = req.query?.tgUserId;
  const access = resolveAccess(fromBody || fromQuery);
  const isDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
  const devAdminFlag = String(req.body?.devAdmin || req.query?.devAdmin || '').trim() === '1';
  if (!access.isAdmin && isDev && devAdminFlag) {
    req.viewerAccess = { ...access, isAdmin: true, devBypass: true };
    return next();
  }
  if (!access.isAdmin) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN_ADMIN_ONLY' });
  }
  req.viewerAccess = access;
  next();
};

router.get('/residential-complexes', requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    }
    const q = String(req.query?.q ?? '').trim();
    const limitRaw = Number.parseInt(String(req.query?.limit ?? '50').trim(), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const items = await listResidentialComplexes(SERVICE_CLIENT_ID, { q, limit });
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
    const tgFromBody = req.body?.tgUserId;
    const tgFromAccess = req.viewerAccess?.tgUserId;
    const createdBy = normalizeId(tgFromBody || tgFromAccess) || null;

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

export default router;
