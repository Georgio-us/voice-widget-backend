import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createManualProperty,
  deactivatePropertyByExternalId,
  getPropertyByExternalId,
  updateManualPropertyByExternalId
} from '../services/propertiesRepository.js';
import {
  detectGovernmentProgramsFromTitle,
  mergeGovernmentProgramFlags
} from '../services/governmentProgramsNormalizer.js';
import { resolveViewerAccessByTgId } from '../services/viewerAccessService.js';
import { getAdminClientsList, getAdminSessionDigest, getAdminStatsSummary } from '../services/adminStatsService.js';
import { resolveTgUserIdForAccess, toHttpAuthError } from '../services/telegramInitDataService.js';

import { sendTargetedBroadcast } from '../services/telegramBot.js';

const router = express.Router();

const SERVICE_CLIENT_ID = String(process.env.CLIENT_ID || '').trim();
const STATS_TIMEZONE = String(process.env.STATS_TIMEZONE || process.env.TZ || 'Europe/Kyiv').trim() || 'Europe/Kyiv';
const MAX_IMAGES = 10;
const IMAGE_WARN_SIZE_MB = (() => {
  const parsed = Number(String(process.env.ADMIN_WARN_IMAGE_MB || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.max(1, Math.min(50, Math.round(parsed)));
})();
const IMAGE_WARN_SIZE_BYTES = IMAGE_WARN_SIZE_MB * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_IMAGES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(String(file.mimetype || '').toLowerCase())) return cb(null, true);
    cb(new Error('UNSUPPORTED_IMAGE_MIME'));
  }
});

const uploadImages = (req, res, next) => {
  upload.array('images', MAX_IMAGES)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ ok: false, error: 'TOO_MANY_IMAGES_MAX_10' });
      return res.status(400).json({ ok: false, error: 'UPLOAD_VALIDATION_ERROR', code: err.code });
    }
    if (String(err?.message || '') === 'UNSUPPORTED_IMAGE_MIME') {
      return res.status(400).json({ ok: false, error: 'UNSUPPORTED_IMAGE_MIME' });
    }
    return next(err);
  });
};

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

const parseIntSafe = (value) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};
const parseDecimalSafe = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
};

const normalizeRooms = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw === '5+') return 5;
  return parseIntSafe(raw);
};

const toBool = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

const normalizeListingOperation = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'rent') return 'rent';
  return 'sale';
};

const requireR2Config = () => {
  const cfg = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    endpoint: process.env.R2_ENDPOINT,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL
  };
  const missing = Object.entries(cfg).filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
  if (missing.length) throw new Error(`R2_CONFIG_MISSING:${missing.join(',')}`);
  return cfg;
};

router.get('/stats/summary', requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    const stats = await getAdminStatsSummary({
      clientId: SERVICE_CLIENT_ID,
      statsTimezone: STATS_TIMEZONE
    });
    return res.json({ ok: true, stats });
  } catch (error) {
    console.error('❌ GET /api/admin/stats/summary error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.get('/stats/session/:sessionId', requireAdmin, async (req, res) => {
  try {
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' });
    const digest = await getAdminSessionDigest(sessionId);
    return res.json({ ok: true, digest });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.json({ ok: true, digest: null });
    }
    console.error('❌ GET /api/admin/stats/session/:sessionId error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.get('/clients/list', requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    const result = await getAdminClientsList({ clientId: SERVICE_CLIENT_ID });
    return res.json({ ok: true, summary: result.summary, clients: result.clients });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.json({ ok: true, summary: { totalClients: 0, withLeads: 0, active7Days: 0 }, clients: [] });
    }
    console.error('❌ GET /api/admin/clients/list error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

const buildS3Client = (cfg) => new S3Client({
  region: 'auto',
  endpoint: cfg.endpoint,
  credentials: {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey
  }
});

const normalizeImageBuffer = async (buffer) => {
  const transformed = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return transformed;
};

const toStringArray = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  const single = String(value || '').trim();
  return single ? [single] : [];
};

const logImageSizes = (files = [], routeTag = 'create') => {
  if (!Array.isArray(files) || !files.length) return;
  files.forEach((file, idx) => {
    const sizeBytes = Number(file?.size || 0);
    const sizeMb = sizeBytes / (1024 * 1024);
    const name = String(file?.originalname || `image_${idx + 1}`).slice(0, 120);
    const mime = String(file?.mimetype || '').slice(0, 60);
    if (sizeBytes > IMAGE_WARN_SIZE_BYTES) {
      console.warn(`⚠️ [admin:${routeTag}] large image accepted: #${idx + 1} "${name}" ${sizeMb.toFixed(2)}MB ${mime}`);
    } else {
      console.log(`🖼️ [admin:${routeTag}] image: #${idx + 1} "${name}" ${sizeMb.toFixed(2)}MB ${mime}`);
    }
  });
};

router.get('/properties/:externalId', requireAdmin, async (req, res) => {
  try {
    const externalId = String(req.params?.externalId || '').trim();
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    if (!externalId) return res.status(400).json({ ok: false, error: 'EXTERNAL_ID_REQUIRED' });
    const property = await getPropertyByExternalId(externalId, SERVICE_CLIENT_ID);
    if (!property) return res.status(404).json({ ok: false, error: 'PROPERTY_NOT_FOUND' });
    return res.json({ ok: true, property });
  } catch (error) {
    console.error('❌ GET /api/admin/properties/:externalId error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.post('/properties', uploadImages, requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    const cfg = requireR2Config();
    const s3 = buildS3Client(cfg);
    const mode = String(req.body?.mode || 'publish').trim().toLowerCase();
    const clientId = SERVICE_CLIENT_ID;
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const propertyType = String(req.body?.propertyType || 'apartment').trim().toLowerCase();
    const operation = normalizeListingOperation(req.body?.operation);
    const district = String(req.body?.district || '').trim();
    const microdistrict = String(req.body?.microdistrict || '').trim();
    const rooms = normalizeRooms(req.body?.rooms);
    const floor = parseIntSafe(req.body?.floor);
    const floorsTotal = parseIntSafe(req.body?.floorsTotal);
    const area = parseDecimalSafe(req.body?.area);
    const explicitLandAreaSotka = parseDecimalSafe(req.body?.landAreaSotka ?? req.body?.land_area_sotka);
    const landAreaSotka = Number.isFinite(explicitLandAreaSotka)
      ? explicitLandAreaSotka
      : (propertyType === 'land' ? area : null);
    const areaM2 = propertyType === 'land' ? null : area;
    const price = parseIntSafe(String(req.body?.price || '').replace(/[^\d]/g, ''));
    const balcony = toBool(req.body?.balcony);
    const terrace = toBool(req.body?.terrace);
    const furnished = false;
    const governmentFlags = mergeGovernmentProgramFlags(
      {
        eoselia: toBool(req.body?.eoselia),
        evidnovlennia: toBool(req.body?.evidnovlennia)
      },
      detectGovernmentProgramsFromTitle(title)
    );

    const files = Array.isArray(req.files) ? req.files : [];
    logImageSizes(files, 'create');
    const now = Date.now();
    const uploadedUrls = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const key = `clients/${clientId}/properties/tmp_${now}_${Math.random().toString(36).slice(2, 10)}/${String(i + 1).padStart(2, '0')}.webp`;
      const body = await normalizeImageBuffer(file.buffer);
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable'
      }));
      const normalizedBase = String(cfg.publicBaseUrl).replace(/\/+$/, '');
      uploadedUrls.push(`${normalizedBase}/${key}`);
    }

    const created = await createManualProperty({
      mode,
      operation,
      title,
      description,
      property_type: propertyType,
      district,
      neighborhood: microdistrict,
      rooms,
      floor,
      building_floors: floorsTotal,
      area_m2: areaM2,
      price_amount: price,
      balcony,
      terrace,
      furnished,
      images: uploadedUrls,
      extraFeatures: {
        exclusive: toBool(req.body?.exclusive),
        penthouse: toBool(req.body?.penthouse),
        smartFlat: toBool(req.body?.smartFlat),
        newbuilding: toBool(req.body?.newbuilding),
        loggia: toBool(req.body?.loggia),
        parking: toBool(req.body?.parking),
        landAreaSotka,
        land_area_sotka: landAreaSotka,
        governmentProgram: toBool(req.body?.governmentProgram) || governmentFlags.governmentProgram,
        governmentPrograms: governmentFlags.governmentPrograms,
        eoselia: governmentFlags.eoselia,
        evidnovlennia: governmentFlags.evidnovlennia,
        complex: String(req.body?.complex || '').trim() || null
      }
    }, clientId);

    return res.status(201).json({
      ok: true,
      mode,
      property: created
    });
  } catch (error) {
    const msg = String(error?.message || 'UNKNOWN_ERROR');
    if (msg.startsWith('R2_CONFIG_MISSING:')) {
      return res.status(500).json({ ok: false, error: msg });
    }
    console.error('❌ /api/admin/properties error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.put('/properties/:externalId', uploadImages, requireAdmin, async (req, res) => {
  try {
    const externalId = String(req.params?.externalId || '').trim();
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    const cfg = requireR2Config();
    const s3 = buildS3Client(cfg);
    const mode = String(req.body?.mode || 'publish').trim().toLowerCase();
    const clientId = SERVICE_CLIENT_ID;
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const propertyType = String(req.body?.propertyType || 'apartment').trim().toLowerCase();
    const operation = normalizeListingOperation(req.body?.operation);
    const district = String(req.body?.district || '').trim();
    const microdistrict = String(req.body?.microdistrict || '').trim();
    const rooms = normalizeRooms(req.body?.rooms);
    const floor = parseIntSafe(req.body?.floor);
    const floorsTotal = parseIntSafe(req.body?.floorsTotal);
    const area = parseDecimalSafe(req.body?.area);
    const explicitLandAreaSotka = parseDecimalSafe(req.body?.landAreaSotka ?? req.body?.land_area_sotka);
    const landAreaSotka = Number.isFinite(explicitLandAreaSotka)
      ? explicitLandAreaSotka
      : (propertyType === 'land' ? area : null);
    const areaM2 = propertyType === 'land' ? null : area;
    const price = parseIntSafe(String(req.body?.price || '').replace(/[^\d]/g, ''));
    const balcony = toBool(req.body?.balcony);
    const terrace = toBool(req.body?.terrace);
    const furnished = false;
    const governmentFlags = mergeGovernmentProgramFlags(
      {
        eoselia: toBool(req.body?.eoselia),
        evidnovlennia: toBool(req.body?.evidnovlennia)
      },
      detectGovernmentProgramsFromTitle(title)
    );

    const files = Array.isArray(req.files) ? req.files : [];
    logImageSizes(files, 'update');
    const now = Date.now();
    const uploadedUrls = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const key = `clients/${clientId}/properties/edit_${now}_${Math.random().toString(36).slice(2, 10)}/${String(i + 1).padStart(2, '0')}.webp`;
      const body = await normalizeImageBuffer(file.buffer);
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable'
      }));
      const normalizedBase = String(cfg.publicBaseUrl).replace(/\/+$/, '');
      uploadedUrls.push(`${normalizedBase}/${key}`);
    }
    const existingImages = toStringArray(req.body?.existingImages);
    const images = uploadedUrls.length ? uploadedUrls : existingImages;

    const updated = await updateManualPropertyByExternalId(
      externalId,
      {
        mode,
        operation,
        title,
        description,
        property_type: propertyType,
        district,
        neighborhood: microdistrict,
        rooms,
        floor,
        building_floors: floorsTotal,
        area_m2: areaM2,
        price_amount: price,
        balcony,
        terrace,
        furnished,
        images,
        extraFeatures: {
          exclusive: toBool(req.body?.exclusive),
          penthouse: toBool(req.body?.penthouse),
          smartFlat: toBool(req.body?.smartFlat),
          newbuilding: toBool(req.body?.newbuilding),
          loggia: toBool(req.body?.loggia),
          parking: toBool(req.body?.parking),
          landAreaSotka,
          land_area_sotka: landAreaSotka,
          governmentProgram: toBool(req.body?.governmentProgram) || governmentFlags.governmentProgram,
          governmentPrograms: governmentFlags.governmentPrograms,
          eoselia: governmentFlags.eoselia,
          evidnovlennia: governmentFlags.evidnovlennia,
          complex: String(req.body?.complex || '').trim() || null
        }
      },
      clientId
    );
    if (!updated) return res.status(404).json({ ok: false, error: 'PROPERTY_NOT_FOUND' });
    return res.json({ ok: true, mode, property: updated });
  } catch (error) {
    const msg = String(error?.message || 'UNKNOWN_ERROR');
    if (msg.startsWith('R2_CONFIG_MISSING:')) {
      return res.status(500).json({ ok: false, error: msg });
    }
    console.error('❌ PUT /api/admin/properties/:externalId error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.post('/properties/delete', requireAdmin, async (req, res) => {
  try {
    const externalId = String(req.body?.externalId || '').trim();
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    const clientId = SERVICE_CLIENT_ID;
    if (!externalId) return res.status(400).json({ ok: false, error: 'EXTERNAL_ID_REQUIRED' });
    const removed = await deactivatePropertyByExternalId(externalId, clientId);
    if (!removed) return res.status(404).json({ ok: false, error: 'PROPERTY_NOT_FOUND_OR_ALREADY_REMOVED' });
    return res.json({ ok: true, removedExternalId: externalId });
  } catch (error) {
    console.error('❌ POST /api/admin/properties/delete error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.delete('/properties/:externalId', requireAdmin, async (req, res) => {
  try {
    const externalId = String(req.params?.externalId || '').trim();
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    const clientId = SERVICE_CLIENT_ID;
    if (!externalId) return res.status(400).json({ ok: false, error: 'EXTERNAL_ID_REQUIRED' });
    const removed = await deactivatePropertyByExternalId(externalId, clientId);
    if (!removed) return res.status(404).json({ ok: false, error: 'PROPERTY_NOT_FOUND_OR_ALREADY_REMOVED' });
    return res.json({ ok: true, removedExternalId: externalId });
  } catch (error) {
    console.error('❌ DELETE /api/admin/properties/:externalId error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});


router.post('/broadcast', requireAdmin, async (req, res) => {
  try {
    const { targetUserIds, messageText, ctaText, photoUrl } = req.body;
    
    if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'TARGET_USERS_REQUIRED' });
    }
    if (!messageText) {
      return res.status(400).json({ ok: false, error: 'MESSAGE_TEXT_REQUIRED' });
    }

    const results = await sendTargetedBroadcast({
      userIds: targetUserIds,
      messageText,
      photoUrl,
      ctaText
    });

    return res.json({ ok: true, results });
  } catch (error) {
    console.error('❌ POST /api/admin/broadcast error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

export default router;
