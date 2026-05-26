import { pool } from './db.js';
import { getPropertyByExternalId } from './propertiesRepository.js';

export const buildPropertyDeepLink = (propertyId) => {
  const id = String(propertyId || '').trim();
  if (!id) return '';
  const botUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim();
  if (botUsername) {
    return `https://t.me/${botUsername}/app?startapp=${encodeURIComponent(`prop_${id}`)}`;
  }
  const base = String(process.env.FRONTEND_URL || '').trim();
  if (!base) return '';
  try {
    const url = new URL(base);
    url.searchParams.set('propId', id);
    return url.toString();
  } catch {
    return `${base.replace(/\/+$/, '')}/?propId=${encodeURIComponent(id)}`;
  }
};

const formatAdminPropertySummary = (row) => {
  if (!row) return '';
  const geo = row.geo && typeof row.geo === 'object' ? row.geo : {};
  const title = String(row.title || '').trim();
  const type = String(row.property_type || '').trim();
  const operation = String(row.operation || '').trim();
  const district = String(geo.district || row.location_district || '').trim();
  const price = Number(row.price_amount);
  const currency = String(row.price_currency || 'USD').trim() || 'USD';
  const priceLabel = Number.isFinite(price) && price > 0 ? `${Math.round(price).toLocaleString('en-US')} ${currency}` : '';
  return [title, operation, type, district, priceLabel].filter(Boolean).join(' · ');
};

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

const makeSafeQuery = (scope, fallbackMode = 'result') => async (label, sql, params = [], fallbackValue = null) => {
  try {
    return await pool.query(sql, params);
  } catch (error) {
    console.warn(`⚠️ ${scope}: ${label} failed`, {
      code: error?.code || null,
      message: error?.message || null
    });
    if (fallbackMode === 'rows') return { rows: Array.isArray(fallbackValue) ? fallbackValue : [] };
    return fallbackValue;
  }
};

const enrichPropertyMeta = async (clientId, propertyIdsRaw = []) => {
  const propertyIds = new Set();
  for (const idRaw of propertyIdsRaw) {
    const id = String(idRaw || '').trim();
    if (id) propertyIds.add(id);
  }
  const propertyById = new Map();
  await Promise.all(Array.from(propertyIds).map(async (id) => {
    try {
      const row = await getPropertyByExternalId(id, clientId);
      if (row) propertyById.set(id.toUpperCase(), row);
    } catch {}
  }));
  return (propertyId) => {
    const id = String(propertyId || '').trim();
    if (!id) return {};
    const row = propertyById.get(id.toUpperCase()) || null;
    return {
      property_url: buildPropertyDeepLink(id),
      property_title: String(row?.title || '').trim() || null,
      property_summary: formatAdminPropertySummary(row) || null
    };
  };
};

export async function getAdminStatsSummary({ clientId, statsTimezone }) {
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

  const safeQuery = makeSafeQuery('stats/summary');
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
    safeQuery('activeProperties', `SELECT COUNT(*)::int AS c FROM properties WHERE client_id = $1 AND is_active = true`, [clientId], { rows: [{ c: 0 }] }),
    safeQuery(
      'leadsToday',
      `
      SELECT COUNT(*)::int AS c
      FROM lead_requests
      WHERE client_id = $1
        AND (NULLIF(created_at::text, '')::timestamptz AT TIME ZONE $2::text)::date = (NOW() AT TIME ZONE $2::text)::date
        AND COALESCE(source, '') !~* '^guest_want_bot'
      `,
      [clientId, statsTimezone],
      { rows: [{ c: 0 }] }
    ),
    safeQuery(
      'sessionsToday',
      `
      SELECT COUNT(*)::int AS c
      FROM session_logs
      WHERE (NULLIF(created_at::text, '')::timestamptz AT TIME ZONE $1::text)::date = (NOW() AT TIME ZONE $1::text)::date
      `,
      [statsTimezone],
      { rows: [{ c: 0 }] }
    ),
    safeQuery('totalUsers', `SELECT COUNT(*)::int AS c FROM users WHERE client_id = $1`, [clientId], { rows: [{ c: 0 }] }),
    safeQuery('usersToday', usersTodaySql, hasUsersFirstSeen ? [clientId, statsTimezone] : [], { rows: [{ c: 0 }] }),
    safeQuery(
      'totalLeads',
      `
      SELECT COUNT(*)::int AS c
      FROM lead_requests
      WHERE client_id = $1
        AND COALESCE(source, '') !~* '^guest_want_bot'
      `,
      [clientId],
      { rows: [{ c: 0 }] }
    ),
    safeQuery('totalSessions', `SELECT COUNT(*)::int AS c FROM session_logs`, [], { rows: [{ c: 0 }] }),
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
        AND COALESCE(source, '') !~* '^guest_want_bot'
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
          AND COALESCE(source, '') !~* '^guest_want_bot'
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

  const recentLeadRows = Array.isArray(recentLeadsResp?.rows) ? recentLeadsResp.rows : [];
  const recentActivityRows = Array.isArray(recentActivityResp?.rows) ? recentActivityResp.rows : [];
  const buildPropertyMeta = await enrichPropertyMeta(clientId, [
    ...recentLeadRows.map((row) => row?.property_id),
    ...recentActivityRows.map((row) => row?.lead_property_id)
  ]);
  const recentLeads = recentLeadRows.map((row) => ({
    ...row,
    ...buildPropertyMeta(row?.property_id)
  }));
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
      lead_property_id: String(row?.lead_property_id || '').trim() || null,
      ...buildPropertyMeta(row?.lead_property_id)
    };
  });

  return {
    activeProperties: activePropsResp?.rows?.[0]?.c ?? 0,
    leadsToday: leadsTodayResp?.rows?.[0]?.c ?? 0,
    sessionsToday: sessionsTodayResp?.rows?.[0]?.c ?? 0,
    totalUsers: totalUsersResp?.rows?.[0]?.c ?? 0,
    usersToday: usersTodayResp?.rows?.[0]?.c ?? 0,
    totalLeads: totalLeadsResp?.rows?.[0]?.c ?? 0,
    totalSessions: totalSessionsResp?.rows?.[0]?.c ?? 0,
    recentLeads,
    recentActivity
  };
}

export async function getAdminSessionDigest(sessionId) {
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
  if (!row) return null;
  const digest = pickLastSessionDetails(row?.payload);
  return {
    sessionId: String(row.session_id || ''),
    createdAt: row.created_at || null,
    messagesCount: digest.messagesCount,
    shownObjectsCount: digest.shownObjectsCount,
    lastUserText: digest.lastUserText || null,
    lastAssistantText: digest.lastAssistantText || null,
    lastInsights: digest.lastInsights || null
  };
}

export async function getAdminClientsList({ clientId }) {
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
    WITH base AS (
      SELECT
        lr.*,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(lr.extra->>'tgUserId', ''), LOWER(REGEXP_REPLACE(COALESCE(lr.extra->>'telegramUsername', ''), '^@', '')))
          ORDER BY lr.created_at DESC NULLS LAST, lr.id DESC
        ) AS rn
      FROM lead_requests lr
      WHERE lr.client_id = $1
        AND COALESCE(lr.source, '') !~* '^guest_want_bot'
        AND (COALESCE(lr.extra->>'tgUserId', '') <> '' OR COALESCE(lr.extra->>'telegramUsername', '') <> '')
    )
    SELECT
      extra->>'tgUserId' AS tg_user_id,
      LOWER(REGEXP_REPLACE(COALESCE(extra->>'telegramUsername', ''), '^@', '')) AS username,
      COUNT(*)::int AS leads_count,
      MAX(created_at) AS last_lead_at,
      MAX(CASE WHEN rn = 1 THEN source END) AS last_lead_source,
      MAX(CASE WHEN rn = 1 THEN property_id END) AS last_lead_property_id
    FROM base
    GROUP BY extra->>'tgUserId', LOWER(REGEXP_REPLACE(COALESCE(extra->>'telegramUsername', ''), '^@', ''))
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
      last_lead_at: row?.last_lead_at || null,
      last_lead_source: String(row?.last_lead_source || '').trim() || null,
      last_lead_property_id: String(row?.last_lead_property_id || '').trim() || null
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
      last_lead_source: lead?.last_lead_source || null,
      last_lead_property_id: lead?.last_lead_property_id || null,
      last_lead_property_url: buildPropertyDeepLink(lead?.last_lead_property_id),
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

  return {
    summary: {
      totalClients: clients.length,
      withLeads: clients.filter((c) => Number(c.leads_count) > 0).length,
      active7Days
    },
    clients
  };
}
