import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '../services/db.js';
import {
  createManualProperty,
  deactivatePropertyByExternalId,
  getPropertyByExternalId,
  updateManualPropertyByExternalId
} from '../services/propertiesRepository.js';
import { resolveViewerAccessByTgId } from '../services/viewerAccessService.js';
import { resolveTgUserIdForAccess, toHttpAuthError } from '../services/telegramInitDataService.js';

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
    const clientId = SERVICE_CLIENT_ID;
    const hasUsersFirstSeenResp = await pool.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'first_seen_at'
      ) AS has_first_seen
      `
    );
    const hasUsersFirstSeen = Boolean(hasUsersFirstSeenResp?.rows?.[0]?.has_first_seen);
    const usersTodaySql = hasUsersFirstSeen
      ? `
        SELECT COUNT(*)::int AS c
        FROM users
        WHERE client_id = $1
          AND (NULLIF(first_seen_at::text, '')::timestamptz AT TIME ZONE $2::text)::date = (NOW() AT TIME ZONE $2::text)::date
      `
      : `
        SELECT 0::int AS c
      `;

    const safeQuery = async (label, sql, params = [], fallbackValue = null) => {
      try {
        return await pool.query(sql, params);
      } catch (error) {
        console.warn(`⚠️ stats/summary: ${label} failed`, {
          code: error?.code || null,
          message: error?.message || null
        });
        return fallbackValue;
      }
    };

    const [
      activePropsResp,
      leadsTodayResp,
      sessionsTodayResp,
      totalUsersResp,
      usersTodayResp,
      totalLeadsResp,
      totalSessionsResp,
      recentLeadsResp,
      recentActivityResp
    ] = await Promise.all([
      safeQuery(
        'activeProperties',
        `SELECT COUNT(*)::int AS c FROM properties WHERE client_id = $1 AND is_active = true`,
        [clientId],
        { rows: [{ c: 0 }] }
      ),
      safeQuery(
        'leadsToday',
        `
        SELECT COUNT(*)::int AS c
        FROM lead_requests
        WHERE client_id = $1
          AND (NULLIF(created_at::text, '')::timestamptz AT TIME ZONE $2::text)::date = (NOW() AT TIME ZONE $2::text)::date
          AND COALESCE(source, '') !~* '^widget_'
        `,
        [clientId, STATS_TIMEZONE],
        { rows: [{ c: 0 }] }
      ),
      safeQuery(
        'sessionsToday',
        `
        SELECT COUNT(*)::int AS c
        FROM session_logs
        WHERE (NULLIF(created_at::text, '')::timestamptz AT TIME ZONE $1::text)::date = (NOW() AT TIME ZONE $1::text)::date
        `,
        [STATS_TIMEZONE],
        { rows: [{ c: 0 }] }
      ),
      safeQuery(
        'totalUsers',
        `SELECT COUNT(*)::int AS c FROM users WHERE client_id = $1`,
        [clientId],
        { rows: [{ c: 0 }] }
      ),
      safeQuery(
        'usersToday',
        usersTodaySql,
        hasUsersFirstSeen ? [clientId, STATS_TIMEZONE] : [],
        { rows: [{ c: 0 }] }
      ),
      safeQuery(
        'totalLeads',
        `
        SELECT COUNT(*)::int AS c
        FROM lead_requests
        WHERE client_id = $1
          AND COALESCE(source, '') !~* '^widget_'
        `,
        [clientId],
        { rows: [{ c: 0 }] }
      ),
      safeQuery(
        'totalSessions',
        `SELECT COUNT(*)::int AS c FROM session_logs`,
        [],
        { rows: [{ c: 0 }] }
      ),
      safeQuery(
        'recentLeads',
        `
        SELECT
          id,
          created_at,
          source,
          name,
          property_id,
          session_id,
          phone_country_code,
          phone_number,
          email,
          extra->>'telegramUsername' AS telegram_username,
          extra->>'tgUserId' AS telegram_user_id
        FROM lead_requests
        WHERE client_id = $1
          AND COALESCE(source, '') !~* '^widget_'
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 5
        `,
        [clientId],
        { rows: [] }
      ),
      safeQuery(
        'recentActivity',
        `
        SELECT
          s.session_id,
          s.created_at,
          s.payload,
          CASE WHEN lr.id IS NULL THEN false ELSE true END AS has_lead,
          lr.source AS lead_source,
          lr.property_id AS lead_property_id,
          lr.name AS lead_name,
          lr.extra->>'telegramUsername' AS lead_telegram_username,
          lr.extra->>'tgUserId' AS lead_telegram_user_id
        FROM session_logs s
        LEFT JOIN LATERAL (
          SELECT id, source, property_id, name, extra
          FROM lead_requests
          WHERE client_id = $1
            AND session_id = s.session_id
            AND COALESCE(source, '') !~* '^widget_'
          ORDER BY created_at DESC NULLS LAST, id DESC
          LIMIT 1
        ) lr ON true
        ORDER BY s.created_at DESC NULLS LAST, s.id DESC
        LIMIT 5
        `,
        [clientId],
        { rows: [] }
      )
    ]);

    const recentActivityRows = Array.isArray(recentActivityResp?.rows) ? recentActivityResp.rows : [];
    const recentActivity = recentActivityRows.map((row) => {
      const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
      const sessionMeta = payload?.sessionMeta && typeof payload.sessionMeta === 'object' ? payload.sessionMeta : {};
      const tgUser = sessionMeta?.telegramUser && typeof sessionMeta.telegramUser === 'object' ? sessionMeta.telegramUser : {};
      const tgUsernameRaw = String(tgUser?.username || row?.lead_telegram_username || '').trim();
      const tgUsername = tgUsernameRaw ? (tgUsernameRaw.startsWith('@') ? tgUsernameRaw : `@${tgUsernameRaw}`) : null;
      const tgUserId = String(tgUser?.userId || row?.lead_telegram_user_id || '').trim() || null;
      const fullName = [tgUser?.firstName, tgUser?.lastName].map((v) => String(v || '').trim()).filter(Boolean).join(' ').trim();
      const fallbackName = String(row?.lead_name || '').trim();
      const name = fullName || fallbackName || '—';
      return {
        session_id: String(row?.session_id || '').trim() || null,
        created_at: row?.created_at || null,
        name,
        telegram_username: tgUsername,
        telegram_user_id: tgUserId,
        left_lead: row?.has_lead === true,
        lead_source: String(row?.lead_source || '').trim() || null,
        lead_property_id: String(row?.lead_property_id || '').trim() || null
      };
    });

    return res.json({
      ok: true,
      stats: {
        activeProperties: activePropsResp?.rows?.[0]?.c ?? 0,
        leadsToday: leadsTodayResp?.rows?.[0]?.c ?? 0,
        sessionsToday: sessionsTodayResp?.rows?.[0]?.c ?? 0,
        totalUsers: totalUsersResp?.rows?.[0]?.c ?? 0,
        usersToday: usersTodayResp?.rows?.[0]?.c ?? 0,
        totalLeads: totalLeadsResp?.rows?.[0]?.c ?? 0,
        totalSessions: totalSessionsResp?.rows?.[0]?.c ?? 0,
        recentLeads: Array.isArray(recentLeadsResp?.rows) ? recentLeadsResp.rows : [],
        recentActivity
      }
    });
  } catch (error) {
    console.error('❌ GET /api/admin/stats/summary error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

router.get('/stats/session/:sessionId', requireAdmin, async (req, res) => {
  try {
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' });

    const { rows } = await pool.query(
      `
      SELECT session_id, created_at, payload
      FROM session_logs
      WHERE session_id = $1
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [sessionId]
    );

    const row = rows?.[0];
    if (!row) return res.json({ ok: true, digest: null });

    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
    const sessionMeta = payload?.sessionMeta && typeof payload.sessionMeta === 'object' ? payload.sessionMeta : {};
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const shownIds = new Set();
    const shownFromMeta = Array.isArray(sessionMeta?.shownProperties) ? sessionMeta.shownProperties : [];
    for (const idRaw of shownFromMeta) {
      const id = String(idRaw || '').trim();
      if (id) shownIds.add(id);
    }
    let lastUserText = null;
    let lastInsights = null;
    let lastAssistantText = null;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i] || {};
      const role = String(m?.role || '').toLowerCase();
      const cards = Array.isArray(m?.cards) ? m.cards : [];
      for (const card of cards) {
        const id = String(card?.id || '').trim();
        if (id) shownIds.add(id);
      }
      if (!lastInsights && m?.meta?.insights && typeof m.meta.insights === 'object') {
        lastInsights = m.meta.insights;
      }
      if (!lastUserText && role === 'user') {
        const candidate = String(m?.transcription || m?.text || '').trim();
        if (candidate) lastUserText = candidate;
      }
      if (!lastAssistantText && role === 'assistant') {
        const candidate = String(m?.text || '').trim();
        if (candidate) lastAssistantText = candidate;
      }
      if (lastUserText && lastInsights && lastAssistantText) break;
    }

    return res.json({
      ok: true,
      digest: {
        sessionId: String(row.session_id || ''),
        createdAt: row.created_at || null,
        messagesCount: messages.length,
        shownObjectsCount: shownIds.size,
        lastUserText: lastUserText || null,
        lastAssistantText: lastAssistantText || null,
        lastInsights: lastInsights || null
      }
    });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.json({ ok: true, digest: null });
    }
    console.error('❌ GET /api/admin/stats/session/:sessionId error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

const pickLastSessionDetails = (payloadRaw) => {
  const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
  const sessionMeta = payload?.sessionMeta && typeof payload.sessionMeta === 'object' ? payload.sessionMeta : {};
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  let lastUserText = null;
  let lastAssistantText = null;
  let lastInsights = null;
  const shownIds = new Set();
  const shownFromMeta = Array.isArray(sessionMeta?.shownProperties) ? sessionMeta.shownProperties : [];
  for (const idRaw of shownFromMeta) {
    const id = String(idRaw || '').trim();
    if (id) shownIds.add(id);
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] || {};
    const role = String(m?.role || '').toLowerCase();
    const cards = Array.isArray(m?.cards) ? m.cards : [];
    for (const card of cards) {
      const id = String(card?.id || '').trim();
      if (id) shownIds.add(id);
    }
    if (!lastInsights && m?.meta?.insights && typeof m.meta.insights === 'object') {
      lastInsights = m.meta.insights;
    }
    if (!lastUserText && role === 'user') {
      const candidate = String(m?.transcription || m?.text || '').trim();
      if (candidate) lastUserText = candidate;
    }
    if (!lastAssistantText && role === 'assistant') {
      const candidate = String(m?.text || '').trim();
      if (candidate) lastAssistantText = candidate;
    }
    if (lastUserText && lastAssistantText && lastInsights) break;
  }
  return {
    messagesCount: messages.length,
    shownObjectsCount: shownIds.size,
    lastUserText,
    lastAssistantText,
    lastInsights
  };
};

router.get('/clients/list', requireAdmin, async (req, res) => {
  try {
    if (!SERVICE_CLIENT_ID) return res.status(500).json({ ok: false, error: 'CLIENT_ID_ENV_REQUIRED' });
    const clientId = SERVICE_CLIENT_ID;
    const safeQuery = async (label, sql, params = [], fallbackRows = []) => {
      try {
        const result = await pool.query(sql, params);
        return Array.isArray(result?.rows) ? result.rows : fallbackRows;
      } catch (error) {
        console.warn(`⚠️ clients/list: ${label} failed`, {
          code: error?.code || null,
          message: error?.message || null
        });
        return fallbackRows;
      }
    };

    const userRows = await safeQuery(
      'users',
      `
      SELECT
        u.id,
        u.client_id,
        u.tg_user_id,
        u.username,
        u.first_name,
        u.last_name,
        u.language_code,
        u.first_seen_at,
        u.last_seen_at
      FROM users u
      WHERE u.client_id = $1
      ORDER BY u.last_seen_at DESC NULLS LAST, u.id DESC
      LIMIT 100
      `,
      [clientId],
      []
    );

    const leadRows = await safeQuery(
      'lead aggregates',
      `
      SELECT
        lr.extra->>'tgUserId' AS tg_user_id,
        LOWER(REGEXP_REPLACE(COALESCE(lr.extra->>'telegramUsername', ''), '^@', '')) AS username,
        COUNT(*)::int AS leads_count,
        MAX(lr.created_at) AS last_lead_at
      FROM lead_requests lr
      WHERE lr.client_id = $1
        AND COALESCE(lr.source, '') !~* '^widget_'
        AND (COALESCE(lr.extra->>'tgUserId', '') <> '' OR COALESCE(lr.extra->>'telegramUsername', '') <> '')
      GROUP BY lr.extra->>'tgUserId', LOWER(REGEXP_REPLACE(COALESCE(lr.extra->>'telegramUsername', ''), '^@', ''))
      `,
      [clientId],
      []
    );

    const sessionRows = await safeQuery(
      'session aggregates',
      `
      WITH ranked AS (
        SELECT
          sl.session_id,
          sl.created_at,
          sl.payload,
          sl.payload#>>'{sessionMeta,telegramUser,userId}' AS tg_user_id,
          ROW_NUMBER() OVER (
            PARTITION BY sl.payload#>>'{sessionMeta,telegramUser,userId}'
            ORDER BY sl.created_at DESC NULLS LAST, sl.id DESC
          ) AS rn,
          COUNT(*) OVER (PARTITION BY sl.payload#>>'{sessionMeta,telegramUser,userId}')::int AS sessions_count
        FROM session_logs sl
        WHERE COALESCE(sl.payload#>>'{sessionMeta,telegramUser,userId}', '') <> ''
      )
      SELECT
        tg_user_id,
        sessions_count,
        session_id AS last_session_id,
        created_at AS last_session_at,
        payload AS last_session_payload
      FROM ranked
      WHERE rn = 1
      `,
      [],
      []
    );

    const leadByTgId = new Map();
    const leadByUsername = new Map();
    for (const row of leadRows) {
      const data = {
        leads_count: Number(row?.leads_count || 0),
        last_lead_at: row?.last_lead_at || null
      };
      const tgId = String(row?.tg_user_id || '').trim();
      const username = String(row?.username || '').trim().toLowerCase();
      if (tgId) leadByTgId.set(tgId, data);
      if (username) leadByUsername.set(username, data);
    }
    const sessionByTgId = new Map();
    for (const row of sessionRows) {
      const tgId = String(row?.tg_user_id || '').trim();
      if (!tgId) continue;
      sessionByTgId.set(tgId, row);
    }

    const clients = userRows.map((row) => {
      const tgId = row?.tg_user_id != null ? String(row.tg_user_id) : '';
      const usernameKey = String(row?.username || '').trim().replace(/^@/, '').toLowerCase();
      const lead = leadByTgId.get(tgId) || leadByUsername.get(usernameKey) || {};
      const session = sessionByTgId.get(tgId) || {};
      const latestSession = pickLastSessionDetails(session?.last_session_payload);
      return {
        id: row?.id || null,
        client_id: row?.client_id || clientId,
        telegram_user_id: tgId || null,
        telegram_username: row?.username ? `@${String(row.username).replace(/^@/, '')}` : null,
        first_name: row?.first_name || null,
        last_name: row?.last_name || null,
        language_code: row?.language_code || null,
        first_seen_at: row?.first_seen_at || null,
        last_seen_at: row?.last_seen_at || null,
        leads_count: Number(lead?.leads_count || 0),
        last_lead_at: lead?.last_lead_at || null,
        sessions_count: Number(session?.sessions_count || 0),
        last_session_id: session?.last_session_id || null,
        last_session_at: session?.last_session_at || null,
        latest_session: latestSession
      };
    }).sort((a, b) => {
      const at = new Date(a.last_seen_at || a.last_session_at || a.last_lead_at || 0).getTime() || 0;
      const bt = new Date(b.last_seen_at || b.last_session_at || b.last_lead_at || 0).getTime() || 0;
      return bt - at;
    });
    const active7Days = clients.filter((c) => {
      const t = new Date(c.last_seen_at || c.last_session_at || c.last_lead_at || 0).getTime();
      return Number.isFinite(t) && t >= Date.now() - 7 * 24 * 60 * 60 * 1000;
    }).length;
    return res.json({
      ok: true,
      summary: {
        totalClients: clients.length,
        withLeads: clients.filter((c) => Number(c.leads_count) > 0).length,
        active7Days
      },
      clients
    });
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
    const price = parseIntSafe(String(req.body?.price || '').replace(/[^\d]/g, ''));
    const balcony = toBool(req.body?.balcony);
    const terrace = toBool(req.body?.terrace);
    const furnished = false;

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
      area_m2: area,
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
    const price = parseIntSafe(String(req.body?.price || '').replace(/[^\d]/g, ''));
    const balcony = toBool(req.body?.balcony);
    const terrace = toBool(req.body?.terrace);
    const furnished = false;

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
        area_m2: area,
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

export default router;
