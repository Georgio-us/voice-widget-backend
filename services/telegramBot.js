import { Telegraf } from 'telegraf';
import { getPropertyByExternalId } from './propertiesRepository.js';
import { upsertTelegramUser } from './usersRepository.js';
import { isAdminTgUser } from './olxOAuthService.js';
import { pool } from './db.js';

const startMessage =
  'Welcome to Odesa Real Estate! I am your AI assistant. How can I help you today?';
const DEFAULT_FRONTEND_URL = '';
const START_PREFIX = 'prop_';
const INLINE_SHARE_PREFIX = 'share_prop_';
const START_SELECTION_PREFIX = 'sel_';
const INLINE_SHARE_SELECTION_PREFIX = 'share_sel_';
const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const VIA_LOGO_FALLBACK = String(process.env.VIA_LOGO_FALLBACK || '').trim();
const BOT_CLIENT_ID = String(process.env.BOT_CLIENT_ID || process.env.CLIENT_ID || 'demo').trim() || 'demo';

let botInstance = null;
let botTransportMode = null; // 'webhook' | 'polling'

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const TELEGRAM_WEBHOOK_PATH = '/api/telegram/webhook';

const normalize = (value) => String(value || '').trim();
const normalizeBool = (value, fallback = true) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'y'].includes(v)) return true;
  if (['0', 'false', 'off', 'no', 'n'].includes(v)) return false;
  return Boolean(fallback);
};
const TELEGRAM_WEBHOOK_PUBLIC_PATH = '/api/telegram/webhook';
const TELEGRAM_WEBHOOK_ALLOW_PUBLIC = normalizeBool(process.env.TELEGRAM_WEBHOOK_ALLOW_PUBLIC, true);
const TELEGRAM_INLINE_SAFE_MODE = normalizeBool(process.env.TELEGRAM_INLINE_SAFE_MODE, false);

function resolveBackendOrigin() {
  const explicitWebhookUrl = normalize(process.env.TELEGRAM_WEBHOOK_URL);
  if (explicitWebhookUrl) {
    try {
      const u = new URL(explicitWebhookUrl);
      return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch {}
  }

  const fromOlxRedirect = normalize(process.env.OLX_REDIRECT_URI);
  if (fromOlxRedirect) {
    try {
      return new URL(fromOlxRedirect).origin;
    } catch {}
  }

  const staticUrl = normalize(process.env.RAILWAY_STATIC_URL);
  if (staticUrl) {
    if (/^https?:\/\//i.test(staticUrl)) return staticUrl.replace(/\/+$/, '');
    return `https://${staticUrl.replace(/\/+$/, '')}`;
  }

  const publicDomain = normalize(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (publicDomain) {
    const host = publicDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (host) return `https://${host}`;
  }

  return '';
}

function buildWebhookSecret(token) {
  const provided = normalize(process.env.TELEGRAM_WEBHOOK_SECRET);
  if (provided) return provided;
  const seed = normalize(process.env.OLX_STATE_SECRET) || normalize(process.env.CLIENT_ID) || 'via-webhook';
  const safeTail = normalize(token).slice(-16).replace(/[^a-zA-Z0-9]/g, '');
  return `via_${seed.slice(0, 16)}_${safeTail}`;
}

async function configureWebhookTransport(bot, token) {
  const originOrUrl = resolveBackendOrigin();
  if (!originOrUrl) {
    throw new Error('WEBHOOK_ORIGIN_NOT_RESOLVED');
  }
  const webhookUrl = /^https?:\/\//i.test(originOrUrl) && originOrUrl.includes('/api/telegram/webhook')
    ? originOrUrl
    : `${originOrUrl.replace(/\/+$/, '')}${TELEGRAM_WEBHOOK_PATH}`;
  const secretToken = buildWebhookSecret(token);
  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query', 'inline_query']
  });
  return { webhookUrl, secretToken };
}

function normalizePropId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toUpperCase();
}

function parseStartPayload(rawPayload) {
  const payload = String(rawPayload || '').trim();
  if (!payload || !payload.startsWith(START_PREFIX)) return null;
  const propId = normalizePropId(payload.slice(START_PREFIX.length));
  return propId || null;
}

function parseSelectionStartPayload(rawPayload) {
  const payload = String(rawPayload || '').trim();
  if (!payload || !payload.startsWith(START_SELECTION_PREFIX)) return null;
  const token = normalizeSelectionToken(payload.slice(START_SELECTION_PREFIX.length));
  return token || null;
}

function parseStartPayloadFromMessage(messageText) {
  const text = String(messageText || '').trim();
  const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  const payload = match?.[1] ? String(match[1]).trim() : '';
  return parseStartPayload(payload);
}

function parseSelectionStartPayloadFromMessage(messageText) {
  const text = String(messageText || '').trim();
  const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  const payload = match?.[1] ? String(match[1]).trim() : '';
  return parseSelectionStartPayload(payload);
}

function buildMiniAppUrl(baseUrl, propId) {
  const base = String(baseUrl || '').trim();
  if (!base) return '';
  if (!propId) return base;
  try {
    const url = new URL(base);
    url.searchParams.set('propId', propId);
    return url.toString();
  } catch {
    const normalizedBase = base.replace(/\/+$/, '');
    return `${normalizedBase}/?propId=${encodeURIComponent(propId)}`;
  }
}

function buildMiniAppSelectionUrl(baseUrl, token) {
  const base = String(baseUrl || '').trim();
  const safeToken = normalizeSelectionToken(token);
  if (!base) return '';
  if (!safeToken) return base;
  try {
    const url = new URL(base);
    url.searchParams.set('selection', safeToken);
    return url.toString();
  } catch {
    const normalizedBase = base.replace(/\/+$/, '');
    return `${normalizedBase}/?selection=${encodeURIComponent(safeToken)}`;
  }
}

function parseInlineSharePropId(inlineQuery) {
  const query = String(inlineQuery || '').trim();
  if (!query.toLowerCase().startsWith(INLINE_SHARE_PREFIX)) return null;
  const raw = query.slice(INLINE_SHARE_PREFIX.length);
  const propId = normalizePropId(raw);
  return propId || null;
}

function normalizeSelectionToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

function parseInlineShareSelectionToken(inlineQuery) {
  const query = String(inlineQuery || '').trim();
  if (!query.toLowerCase().startsWith(INLINE_SHARE_SELECTION_PREFIX)) return null;
  const raw = query.slice(INLINE_SHARE_SELECTION_PREFIX.length);
  const token = normalizeSelectionToken(raw);
  return token || null;
}

function decodeSelectionIds(token) {
  const safe = normalizeSelectionToken(token);
  if (!safe) return [];
  const padded = safe.replace(/-/g, '+').replace(/_/g, '/');
  const fixed = padded + '='.repeat((4 - (padded.length % 4 || 4)) % 4);
  try {
    const decoded = Buffer.from(fixed, 'base64').toString('utf8');
    return Array.from(new Set(
      String(decoded || '')
        .split(',')
        .map((id) => normalizePropId(id))
        .filter(Boolean)
    ));
  } catch {
    return [];
  }
}

function buildMiniAppDeepLink(propId) {
  const id = normalizePropId(propId);
  if (!id || !TELEGRAM_BOT_USERNAME) return '';
  return `https://t.me/${TELEGRAM_BOT_USERNAME}/app?startapp=${encodeURIComponent(`${START_PREFIX}${id}`)}`;
}

function buildMiniAppSelectionDeepLink(token) {
  const safeToken = normalizeSelectionToken(token);
  if (!safeToken || !TELEGRAM_BOT_USERNAME) return '';
  return `https://t.me/${TELEGRAM_BOT_USERNAME}/app?startapp=${encodeURIComponent(`${START_SELECTION_PREFIX}${safeToken}`)}`;
}

function parseImages(rawImages) {
  if (Array.isArray(rawImages)) return rawImages.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof rawImages === 'string') {
    const text = rawImages.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
    } catch {}
    return text.split(',').map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

function formatPriceLabel(raw) {
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return `${Math.round(num).toLocaleString('en-US')} USD`;
  const text = String(raw || '').trim();
  return text || 'Price on request';
}

function formatPropertyTypeRu(rawType) {
  const type = String(rawType || '').trim().toLowerCase();
  if (!type) return 'Объект';
  if (['apartment', 'flat'].includes(type)) return 'Квартира';
  if (type === 'house') return 'Дом';
  if (type === 'commercial') return 'Коммерция';
  if (type === 'land') return 'Земля';
  if (type === 'parking') return 'Паркинг';
  return String(rawType || '').trim() || 'Объект';
}

function formatRoomsRu(rawRooms) {
  const n = Number(rawRooms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const v = Math.round(n);
  const suffix = v === 1 ? 'комната' : (v >= 2 && v <= 4 ? 'комнаты' : 'комнат');
  return `${v} ${suffix}`;
}

function formatAreaM2(rawArea) {
  const n = Number(rawArea);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const text = Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '').replace('.', ',');
  return `${text} м²`;
}

function isValidPublicImageUrl(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\//i.test(value)) return false;
  if (value.includes('<backend-host>')) return false;
  return true;
}

async function getPropertyForInlineShare(propId) {
  const raw = await getPropertyByExternalId(propId);
  if (!raw) return null;
  const images = parseImages(raw.images);
  const geo = raw && raw.geo && typeof raw.geo === 'object' ? raw.geo : null;
  return {
    id: normalizePropId(raw.external_id || raw.id),
    title: String(raw.title || '').trim(),
    propertyType: String(raw.property_type || 'property').trim(),
    propertyTypeLabel: formatPropertyTypeRu(raw.property_type || 'property'),
    city: String(geo?.city || raw.location_city || '').trim(),
    district: String(geo?.district || raw.location_district || raw.location_neighborhood || '').trim(),
    neighborhood: String(geo?.neighborhood || raw.location_neighborhood || '').trim(),
    rooms: Number(raw.specs_rooms ?? raw.rooms ?? 0) || null,
    areaM2: Number(raw.specs_area_m2 ?? raw.area_m2 ?? raw.area ?? 0) || null,
    priceLabel: formatPriceLabel(raw.price_amount),
    image: images[0] || ''
  };
}

const normalizeAlertsMode = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (['off', 'none', '0', 'false'].includes(v)) return 'off';
  if (['basic'].includes(v)) return 'basic';
  if (['on', 'full', 'all', '1', 'true'].includes(v)) return 'full';
  return '';
};

const buildGuestMenuText = () => [
  '🏠 Добро пожаловать в каталог недвижимости.',
  'Нажмите «🚀 Открыть каталог», чтобы смотреть объекты.',
  '✍️ Если нужна консультация — напишите сообщение прямо здесь.'
].join('\n');

const alertsStateEmoji = (flag) => (flag ? '✅' : '❌');

const buildAdminMenuText = (alerts = { leads: true, activity: true }) => [
  '🛠️ Админ-панель',
  '━━━━━━━━━━━━━━━━━━━━',
  `🔔 Лиды: ${alertsStateEmoji(alerts.leads)}`,
  `👣 Активность: ${alertsStateEmoji(alerts.activity)}`,
  '',
  'Команды:',
  '/menu — открыть админ-меню',
  '/stats — статистика за сегодня',
  '/alerts — статус уведомлений'
].join('\n');

const getOpenCatalogKeyboard = (miniAppUrl) => (
  miniAppUrl
    ? {
        inline_keyboard: [
          [{ text: '🚀 ОТКРЫТЬ КАТАЛОГ НЕДВИЖИМОСТИ', web_app: { url: miniAppUrl } }]
        ]
      }
    : undefined
);

const getAdminMenuKeyboard = (miniAppUrl, alerts = { leads: true, activity: true }) => ({
  inline_keyboard: [
    ...(miniAppUrl ? [[{ text: '🚀 Открыть каталог', web_app: { url: miniAppUrl } }]] : []),
    [{ text: '📊 Статистика за сегодня', callback_data: 'menu_stats' }],
    [{ text: `${alerts.leads ? '✅' : '❌'} Лиды`, callback_data: 'toggle_alerts_leads' }],
    [{ text: `${alerts.activity ? '✅' : '❌'} Активность`, callback_data: 'toggle_alerts_activity' }],
    [{ text: '🔄 Обновить меню', callback_data: 'menu_refresh' }]
  ]
});

async function getAlertsConfig(clientId, tgUserId) {
  const safeClientId = String(clientId || BOT_CLIENT_ID).trim() || BOT_CLIENT_ID;
  const safeTg = Number(tgUserId);
  if (!Number.isFinite(safeTg)) return { leads: true, activity: true };
  try {
    const { rows } = await pool.query(
      `
      SELECT meta
      FROM users
      WHERE client_id = $1 AND tg_user_id = $2
      LIMIT 1
      `,
      [safeClientId, safeTg]
    );
    const meta = rows?.[0]?.meta && typeof rows[0].meta === 'object' ? rows[0].meta : {};
    const alerts = meta?.telegram_alerts && typeof meta.telegram_alerts === 'object' ? meta.telegram_alerts : {};
    const legacyMode = normalizeAlertsMode(alerts.mode || '');
    if (legacyMode === 'off') return { leads: false, activity: false };
    if (legacyMode === 'basic') return { leads: true, activity: false };
    if (legacyMode === 'full') return { leads: true, activity: true };
    return {
      leads: normalizeBool(alerts.leads, true),
      activity: normalizeBool(alerts.activity, true)
    };
  } catch (error) {
    if (error?.code === '42P01') return { leads: true, activity: true };
    throw error;
  }
}

async function setAlertsConfig(clientId, tgUserId, patch = {}) {
  const safeClientId = String(clientId || BOT_CLIENT_ID).trim() || BOT_CLIENT_ID;
  const safeTg = Number(tgUserId);
  if (!Number.isFinite(safeTg)) return { ok: false };
  const current = await getAlertsConfig(safeClientId, safeTg);
  const next = {
    leads: Object.prototype.hasOwnProperty.call(patch, 'leads') ? Boolean(patch.leads) : current.leads,
    activity: Object.prototype.hasOwnProperty.call(patch, 'activity') ? Boolean(patch.activity) : current.activity
  };
  try {
    await pool.query(
      `
      UPDATE users
      SET
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'telegram_alerts',
          jsonb_build_object(
            'leads', $3::boolean,
            'activity', $4::boolean,
            'updated_at', NOW()
          )
        ),
        last_seen_at = NOW()
      WHERE client_id = $1 AND tg_user_id = $2
      `,
      [safeClientId, safeTg, next.leads, next.activity]
    );
    return { ok: true, alerts: next };
  } catch (error) {
    if (error?.code === '42P01') return { ok: false, reason: 'users_table_missing' };
    throw error;
  }
}

async function getTodayStats(clientId) {
  const safeClientId = String(clientId || BOT_CLIENT_ID).trim() || BOT_CLIENT_ID;
  const fallback = { activeProperties: null, leadsToday: null, sessionsToday: null };
  try {
    const [{ rows: pRows }, { rows: lRows }, { rows: sRows }] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS c FROM properties WHERE client_id = $1 AND is_active = true`,
        [safeClientId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM lead_requests WHERE client_id = $1 AND created_at::date = NOW()::date`,
        [safeClientId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM session_logs WHERE payload->>'clientId' = $1 AND created_at::date = NOW()::date`,
        [safeClientId]
      )
    ]);
    return {
      activeProperties: pRows?.[0]?.c ?? 0,
      leadsToday: lRows?.[0]?.c ?? 0,
      sessionsToday: sRows?.[0]?.c ?? 0
    };
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') return fallback;
    throw error;
  }
}

async function getRecentLeads(clientId, limit = 5) {
  const safeClientId = String(clientId || BOT_CLIENT_ID).trim() || BOT_CLIENT_ID;
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  try {
    const { rows } = await pool.query(
      `
      SELECT id, created_at, source, name, property_id
      FROM lead_requests
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [safeClientId, safeLimit]
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (error?.code === '42P01') return [];
    throw error;
  }
}

export async function startTelegramBot() {
  if (botInstance) {
    return botInstance;
  }

  const token = process.env.TELEGRAM_INTERACTIVE_TOKEN;
  if (!token) {
    console.warn(
      '⚠️ TELEGRAM_INTERACTIVE_TOKEN не задан. Интерактивный Telegram-бот не запущен.'
    );
    return null;
  }

  const bot = new Telegraf(token);
  const miniAppUrl = String(process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).trim();
  const webAppButtonText = 'Talk to AI / Catalog 🏗️';
  if (TELEGRAM_INLINE_SAFE_MODE) {
    console.warn('⚠️ TELEGRAM_INLINE_SAFE_MODE=1: inline results are forced to minimal article payload.');
  }
  if (!miniAppUrl) {
    console.warn('⚠️ FRONTEND_URL не задан. WebApp-кнопки будут ограничены.');
  }

  const setMenuButton = async (chatId = null) => {
    if (!miniAppUrl) return;
    try {
      await bot.telegram.callApi('setChatMenuButton', {
        ...(chatId ? { chat_id: chatId } : {}),
        menu_button: {
          type: 'web_app',
          text: webAppButtonText,
          web_app: { url: miniAppUrl }
        }
      });
    } catch (error) {
      console.warn('⚠️ Не удалось установить Telegram Menu Button:', error?.message || error);
    }
  };

  await setMenuButton();

  bot.start(async (ctx) => {
    try {
      const from = ctx?.from || {};
      await upsertTelegramUser({
        clientId: BOT_CLIENT_ID,
        tgUserId: from?.id,
        username: from?.username || null,
        firstName: from?.first_name || null,
        lastName: from?.last_name || null,
        languageCode: from?.language_code || null,
        meta: { source: 'telegram_start' }
      });
    } catch (userSyncError) {
      console.warn('[telegram] users upsert failed:', userSyncError?.message || userSyncError);
    }

    const tgUserId = String(ctx?.from?.id || '').trim();
    const isAdmin = isAdminTgUser(tgUserId);
    const propIdFromPayload = parseStartPayload(ctx.startPayload);
    const propIdFromText = parseStartPayloadFromMessage(ctx.message?.text);
    const selectionTokenFromPayload = parseSelectionStartPayload(ctx.startPayload);
    const selectionTokenFromText = parseSelectionStartPayloadFromMessage(ctx.message?.text);
    const propId = propIdFromPayload || propIdFromText || null;
    const selectionToken = selectionTokenFromPayload || selectionTokenFromText || null;
    const launchUrl = selectionToken
      ? buildMiniAppSelectionUrl(miniAppUrl, selectionToken)
      : buildMiniAppUrl(miniAppUrl, propId);

    await setMenuButton(ctx.chat?.id);

    const adminAlerts = isAdmin ? await getAlertsConfig(BOT_CLIENT_ID, tgUserId) : null;
    const inlineKeyboardMarkup = isAdmin ? getAdminMenuKeyboard(launchUrl, adminAlerts) : getOpenCatalogKeyboard(launchUrl);
    let replyText = startMessage;
    if (selectionToken) {
      const count = decodeSelectionIds(selectionToken).length;
      replyText = count > 0
        ? `Здравствуйте! Для вас подготовлена подборка из ${count} объектов. Нажмите «Открыть каталог».`
        : 'Здравствуйте! Для вас подготовлена подборка. Нажмите «Открыть каталог».';
    } else if (propId) {
      replyText = `Открываю объект ${propId}. Нажмите «Открыть каталог».`;
    } else if (isAdmin) {
      replyText = buildAdminMenuText(adminAlerts);
    } else {
      replyText = buildGuestMenuText();
    }
    await ctx.reply(replyText, inlineKeyboardMarkup ? { reply_markup: inlineKeyboardMarkup } : undefined);
  });

  bot.command('menu', async (ctx) => {
    try {
      const tgUserId = String(ctx?.from?.id || '').trim();
      const isAdmin = isAdminTgUser(tgUserId);
      const alerts = isAdmin ? await getAlertsConfig(BOT_CLIENT_ID, tgUserId) : null;
      const replyText = isAdmin ? buildAdminMenuText(alerts) : buildGuestMenuText();
      const keyboard = isAdmin ? getAdminMenuKeyboard(miniAppUrl, alerts) : getOpenCatalogKeyboard(miniAppUrl);
      await ctx.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined);
    } catch (error) {
      console.warn('telegram /menu failed:', error?.message || error);
    }
  });

  bot.command('alerts', async (ctx) => {
    try {
      const tgUserId = String(ctx?.from?.id || '').trim();
      const isAdmin = isAdminTgUser(tgUserId);
      if (!isAdmin) {
        await ctx.reply('Эта команда доступна только администратору.');
        return;
      }
      const text = String(ctx.message?.text || '').trim();
      const parts = text.split(/\s+/).filter(Boolean);
      const arg1 = String(parts[1] || '').toLowerCase();
      const arg2 = String(parts[2] || '').toLowerCase();
      const current = await getAlertsConfig(BOT_CLIENT_ID, tgUserId);

      if (!arg1) {
        await ctx.reply([
          'Текущие уведомления:',
          `• Лиды: ${current.leads ? 'включены ✅' : 'выключены ❌'}`,
          `• Активность: ${current.activity ? 'включена ✅' : 'выключена ❌'}`,
          '',
          'Использование:',
          '/alerts leads on|off',
          '/alerts activity on|off'
        ].join('\n'));
        return;
      }

      const legacy = normalizeAlertsMode(arg1);
      if (legacy) {
        const patch = legacy === 'off'
          ? { leads: false, activity: false }
          : legacy === 'basic'
            ? { leads: true, activity: false }
            : { leads: true, activity: true };
        const result = await setAlertsConfig(BOT_CLIENT_ID, tgUserId, patch);
        const a = result.alerts || patch;
        await ctx.reply(`Обновлено.\n• Лиды: ${a.leads ? '✅' : '❌'}\n• Активность: ${a.activity ? '✅' : '❌'}`);
        return;
      }

      if (!['leads', 'activity'].includes(arg1) || !['on', 'off'].includes(arg2)) {
        await ctx.reply('Неверный формат.\nИспользуйте: /alerts leads on|off или /alerts activity on|off');
        return;
      }
      const patch = arg1 === 'leads'
        ? { leads: arg2 === 'on' }
        : { activity: arg2 === 'on' };
      const result = await setAlertsConfig(BOT_CLIENT_ID, tgUserId, patch);
      const a = result.alerts || { ...current, ...patch };
      await ctx.reply(`Обновлено.\n• Лиды: ${a.leads ? '✅' : '❌'}\n• Активность: ${a.activity ? '✅' : '❌'}`);
    } catch (error) {
      console.warn('telegram /alerts failed:', error?.message || error);
      await ctx.reply('Не удалось обновить режим уведомлений.');
    }
  });

  bot.command('stats', async (ctx) => {
    try {
      const tgUserId = String(ctx?.from?.id || '').trim();
      if (!isAdminTgUser(tgUserId)) {
        await ctx.reply('Эта команда доступна только администратору.');
        return;
      }
      const stats = await getTodayStats(BOT_CLIENT_ID);
      await ctx.reply([
        'Статистика за сегодня:',
        `• Активных объектов: ${stats.activeProperties ?? '—'}`,
        `• Новых заявок: ${stats.leadsToday ?? '—'}`,
        `• Новых сессий: ${stats.sessionsToday ?? '—'}`
      ].join('\n'));
    } catch (error) {
      console.warn('telegram /stats failed:', error?.message || error);
      await ctx.reply('Не удалось получить статистику.');
    }
  });

  bot.action('menu_stats', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    try {
      const tgUserId = String(ctx?.from?.id || '').trim();
      if (!isAdminTgUser(tgUserId)) return;
      const stats = await getTodayStats(BOT_CLIENT_ID);
      await ctx.reply([
        'Статистика за сегодня:',
        `• Активных объектов: ${stats.activeProperties ?? '—'}`,
        `• Новых заявок: ${stats.leadsToday ?? '—'}`,
        `• Новых сессий: ${stats.sessionsToday ?? '—'}`
      ].join('\n'));
    } catch {}
  });
  bot.action('toggle_alerts_leads', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    try {
      const tgUserId = String(ctx?.from?.id || '').trim();
      if (!isAdminTgUser(tgUserId)) return;
      const current = await getAlertsConfig(BOT_CLIENT_ID, tgUserId);
      const result = await setAlertsConfig(BOT_CLIENT_ID, tgUserId, { leads: !current.leads });
      const alerts = result.alerts || { ...current, leads: !current.leads };
      await ctx.reply(`Уведомления лидов: ${alerts.leads ? 'включены ✅' : 'выключены ❌'}`);
      await ctx.reply(buildAdminMenuText(alerts), { reply_markup: getAdminMenuKeyboard(miniAppUrl, alerts) });
    } catch {}
  });
  bot.action('toggle_alerts_activity', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    try {
      const tgUserId = String(ctx?.from?.id || '').trim();
      if (!isAdminTgUser(tgUserId)) return;
      const current = await getAlertsConfig(BOT_CLIENT_ID, tgUserId);
      const result = await setAlertsConfig(BOT_CLIENT_ID, tgUserId, { activity: !current.activity });
      const alerts = result.alerts || { ...current, activity: !current.activity };
      await ctx.reply(`Уведомления активности: ${alerts.activity ? 'включены ✅' : 'выключены ❌'}`);
      await ctx.reply(buildAdminMenuText(alerts), { reply_markup: getAdminMenuKeyboard(miniAppUrl, alerts) });
    } catch {}
  });
  bot.action('menu_refresh', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    try {
      const tgUserId = String(ctx?.from?.id || '').trim();
      if (!isAdminTgUser(tgUserId)) return;
      const alerts = await getAlertsConfig(BOT_CLIENT_ID, tgUserId);
      await ctx.reply(buildAdminMenuText(alerts), { reply_markup: getAdminMenuKeyboard(miniAppUrl, alerts) });
    } catch {}
  });

  bot.on('inline_query', async (ctx) => {
    try {
      const query = String(ctx.inlineQuery?.query || '').trim();
      console.log('Received inline query:', query);
      const propId = parseInlineSharePropId(query);
      const selectionToken = parseInlineShareSelectionToken(query);
      if (!propId && !selectionToken) {
        try {
          await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
        } catch (answerError) {
          console.warn('answerInlineQuery rejected (empty/no propId):', answerError?.response?.description || answerError?.message || answerError);
        }
        return;
      }

      if (selectionToken) {
        const ids = decodeSelectionIds(selectionToken);
        if (!ids.length) {
          try {
            await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
          } catch (answerError) {
            console.warn('answerInlineQuery rejected (selection decode):', answerError?.response?.description || answerError?.message || answerError);
          }
          return;
        }
        const first = await getPropertyForInlineShare(ids[0]);
        const total = ids.length;
        const heading = `Подборка из ${total} объектов`;
        const messageText = [
          `🏘 Подобрал для вас подборку из ${total} объектов.`,
          '📸 Откройте карточки — внутри все детали и фото.'
        ].join('\n');
        const miniAppDeepLink = buildMiniAppSelectionDeepLink(selectionToken);
        const imageUrl = isValidPublicImageUrl(first?.image) ? first.image : '';
        const openUrl = miniAppDeepLink || miniAppUrl || '';
        const maybeReplyMarkup = openUrl
          ? {
              inline_keyboard: [
                [{ text: 'Смотреть подборку', url: openUrl }]
              ]
            }
          : undefined;
        const articleResult = {
          type: 'article',
          id: `share_sel_article_${selectionToken.slice(0, 24)}_${Date.now()}`,
          title: `🏘 ${heading}`,
          description: `🏠 ${total} объектов`,
          input_message_content: {
            message_text: messageText
          },
          ...(maybeReplyMarkup ? { reply_markup: maybeReplyMarkup } : {}),
          ...(VIA_LOGO_FALLBACK ? { thumb_url: VIA_LOGO_FALLBACK } : {})
        };
        const safeArticleResult = {
          type: 'article',
          id: `share_sel_article_safe_${selectionToken.slice(0, 24)}_${Date.now()}`,
          title: `🏘 ${heading}`,
          description: `🏠 ${total} объектов`,
          input_message_content: {
            message_text: messageText
          }
        };
        const photoResult = {
          type: 'photo',
          id: `share_sel_photo_${selectionToken.slice(0, 24)}_${Date.now()}`,
          photo_url: imageUrl,
          thumbnail_url: imageUrl,
          title: `🏘 ${heading}`,
          description: `🏠 ${total} объектов`,
          caption: messageText,
          ...(maybeReplyMarkup ? { reply_markup: maybeReplyMarkup } : {})
        };
        const result = TELEGRAM_INLINE_SAFE_MODE
          ? safeArticleResult
          : (imageUrl ? photoResult : articleResult);
        try {
          await ctx.answerInlineQuery([result], { cache_time: 0, is_personal: true });
        } catch (answerError) {
          console.warn('answerInlineQuery rejected (selection result):', answerError?.response?.description || answerError?.message || answerError);
          if (!TELEGRAM_INLINE_SAFE_MODE && result.type === 'photo') {
            try {
              await ctx.answerInlineQuery([safeArticleResult], { cache_time: 0, is_personal: true });
              return;
            } catch (retryError) {
              console.warn('answerInlineQuery rejected (selection safe fallback):', retryError?.response?.description || retryError?.message || retryError);
            }
          }
          throw answerError;
        }
        return;
      }

      console.log('Inline share property ID to lookup:', propId);
      const property = await getPropertyForInlineShare(propId);
      if (!property) {
        try {
          await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
        } catch (answerError) {
          console.warn('answerInlineQuery rejected (property not found):', answerError?.response?.description || answerError?.message || answerError);
        }
        return;
      }

      const district = property.district || property.neighborhood || '—';
      const roomsLabel = formatRoomsRu(property.rooms);
      const typeWithRooms = roomsLabel ? `${property.propertyTypeLabel}, ${roomsLabel}` : property.propertyTypeLabel;
      const heading = typeWithRooms;
      const messageText = [
        '🏡 Подобрал объект, который может вам подойти.',
        `🏷 Тип: ${typeWithRooms}`,
        `💰 Цена: ${property.priceLabel || '—'}`,
        `📐 Площадь: ${formatAreaM2(property.areaM2)}`,
        `📍 Район: ${district || '—'}`
      ].join('\n');

      const miniAppDeepLink = buildMiniAppDeepLink(property.id);
      const imageUrl = isValidPublicImageUrl(property.image) ? property.image : '';
      const openUrl = miniAppDeepLink || miniAppUrl || '';
      const maybeReplyMarkup = openUrl
        ? {
            inline_keyboard: [
              [{ text: 'Смотреть объект', url: openUrl }]
            ]
          }
        : undefined;
      const articleResult = {
        type: 'article',
        id: `share_article_${property.id}_${Date.now()}`,
        title: `🏙 ${heading}`,
        description: `💰 ${property.priceLabel} • 📍 ${district}`,
        input_message_content: {
          message_text: messageText
        },
        ...(maybeReplyMarkup ? { reply_markup: maybeReplyMarkup } : {}),
        ...(VIA_LOGO_FALLBACK ? { thumb_url: VIA_LOGO_FALLBACK } : {})
      };
      const safeArticleResult = {
        type: 'article',
        id: `share_article_safe_${property.id}_${Date.now()}`,
        title: `🏙 ${heading}`,
        description: `💰 ${property.priceLabel} • 📍 ${district}`,
        input_message_content: {
          message_text: messageText
        }
      };
      const photoResult = {
        type: 'photo',
        id: `share_photo_${property.id}_${Date.now()}`,
        photo_url: imageUrl,
        thumbnail_url: imageUrl,
        title: `🏙 ${heading}`,
        description: `💰 ${property.priceLabel} • 📍 ${district}`,
        caption: messageText,
        ...(maybeReplyMarkup ? { reply_markup: maybeReplyMarkup } : {})
      };
      const result = TELEGRAM_INLINE_SAFE_MODE
        ? safeArticleResult
        : (imageUrl ? photoResult : articleResult);

      console.log('Inline query result prepared:', {
        id: result.id,
        type: result.type,
        title: result.title,
        hasThumb: Boolean(result.thumb_url || result.thumbnail_url),
        miniAppDeepLink
      });
      try {
        await ctx.answerInlineQuery([result], { cache_time: 0, is_personal: true });
      } catch (answerError) {
        console.warn('answerInlineQuery rejected (with result):', answerError?.response?.description || answerError?.message || answerError);
        if (!TELEGRAM_INLINE_SAFE_MODE && result.type === 'photo') {
          try {
            await ctx.answerInlineQuery([safeArticleResult], { cache_time: 0, is_personal: true });
            return;
          } catch (retryError) {
            console.warn('answerInlineQuery rejected (safe fallback):', retryError?.response?.description || retryError?.message || retryError);
          }
        }
        throw answerError;
      }
    } catch (error) {
      console.warn('inline_query handling failed:', error?.message || error);
      try {
        await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
      } catch (fallbackError) {
        console.warn('answerInlineQuery fallback rejected:', fallbackError?.response?.description || fallbackError?.message || fallbackError);
      }
    }
  });

  bot.on('text', async (ctx) => {
    const incomingText = String(ctx.message?.text || '').trim();
    const lower = incomingText.toLowerCase();
    if (lower === 'каталог' || lower === 'открыть каталог') {
      const keyboard = getOpenCatalogKeyboard(miniAppUrl);
      await ctx.reply('Открываю каталог.', keyboard ? { reply_markup: keyboard } : undefined);
      return;
    }
    if (lower === 'меню') {
      const tgUserId = String(ctx?.from?.id || '').trim();
      const isAdmin = isAdminTgUser(tgUserId);
      const alerts = isAdmin ? await getAlertsConfig(BOT_CLIENT_ID, tgUserId) : null;
      const replyText = isAdmin ? buildAdminMenuText(alerts) : buildGuestMenuText();
      const keyboard = isAdmin ? getAdminMenuKeyboard(miniAppUrl, alerts) : getOpenCatalogKeyboard(miniAppUrl);
      await ctx.reply(replyText, keyboard ? { reply_markup: keyboard } : undefined);
      return;
    }
    await ctx.reply('Нажмите «Открыть каталог» или используйте /menu.');
  });

  try {
    if (isProd) {
      const { webhookUrl, secretToken } = await configureWebhookTransport(bot, token);
      botInstance = bot;
      botTransportMode = 'webhook';
      botInstance.__webhookPath = TELEGRAM_WEBHOOK_PATH;
      botInstance.__webhookSecret = secretToken;
      botInstance.__webhookUrl = webhookUrl;
      console.log(`🤖 Telegram interactive bot запущен (webhook): ${webhookUrl}`);
      return botInstance;
    }

    await bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
    await bot.launch();
    botInstance = bot;
    botTransportMode = 'polling';
    console.log('🤖 Telegram interactive bot запущен (polling)');
    return botInstance;
  } catch (error) {
    console.warn(`⚠️ Webhook setup failed, fallback to polling: ${error?.message || error}`);
    await bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
    await bot.launch();
    botInstance = bot;
    botTransportMode = 'polling';
    console.log('🤖 Telegram interactive bot запущен (polling fallback)');
  }

  return botInstance;
}

export function stopTelegramBot(signal = 'SIGTERM') {
  if (!botInstance) {
    return;
  }

  if (botTransportMode === 'polling') {
    botInstance.stop(signal);
  }
  console.log(`🤖 Telegram interactive bot остановлен (${signal}) mode=${botTransportMode || 'unknown'}`);
  botInstance = null;
  botTransportMode = null;
}

export async function telegramWebhookExpressHandler(req, res) {
  try {
    if (!botInstance) {
      return res.status(503).json({ ok: false, error: 'BOT_NOT_READY' });
    }
    const expectedSecret = String(botInstance.__webhookSecret || '').trim();
    const incomingSecret = String(req.headers?.['x-telegram-bot-api-secret-token'] || '').trim();
    const requestPath = String(req.path || req.originalUrl || '').trim();
    const isWebhookPublicPath = requestPath === TELEGRAM_WEBHOOK_PUBLIC_PATH
      || requestPath.endsWith(TELEGRAM_WEBHOOK_PUBLIC_PATH);
    if (expectedSecret && incomingSecret !== expectedSecret) {
      if (!(TELEGRAM_WEBHOOK_ALLOW_PUBLIC && isWebhookPublicPath)) {
        return res.status(401).json({ ok: false, error: 'INVALID_WEBHOOK_SECRET' });
      }
      console.warn('telegram webhook secret mismatch ignored (public webhook mode enabled)');
    }
    const update = req.body;
    if (!update || typeof update !== 'object') {
      return res.status(400).json({ ok: false, error: 'INVALID_UPDATE_BODY' });
    }
    await botInstance.handleUpdate(update, res);
    if (!res.headersSent) return res.status(200).json({ ok: true });
    return undefined;
  } catch (error) {
    console.warn('telegram webhook handler failed:', error?.message || error);
    if (!res.headersSent) return res.status(200).json({ ok: true });
    return undefined;
  }
}
