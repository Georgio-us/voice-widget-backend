import { Telegraf } from 'telegraf';
import { getPropertyByExternalId } from './propertiesRepository.js';
import { upsertTelegramUser } from './usersRepository.js';

const startMessage =
  'Welcome to Odesa Real Estate! I am your AI assistant. How can I help you today?';
const DEFAULT_FRONTEND_URL = '';
const START_PREFIX = 'prop_';
const INLINE_SHARE_PREFIX = 'share_prop_';
const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const VIA_LOGO_FALLBACK = String(process.env.VIA_LOGO_FALLBACK || '').trim();
const BOT_CLIENT_ID = String(process.env.BOT_CLIENT_ID || process.env.CLIENT_ID || 'demo').trim() || 'demo';

let botInstance = null;

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

function parseStartPayloadFromMessage(messageText) {
  const text = String(messageText || '').trim();
  const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  const payload = match?.[1] ? String(match[1]).trim() : '';
  return parseStartPayload(payload);
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

function parseInlineSharePropId(inlineQuery) {
  const query = String(inlineQuery || '').trim();
  if (!query.toLowerCase().startsWith(INLINE_SHARE_PREFIX)) return null;
  const raw = query.slice(INLINE_SHARE_PREFIX.length);
  const propId = normalizePropId(raw);
  return propId || null;
}

function buildMiniAppDeepLink(propId) {
  const id = normalizePropId(propId);
  if (!id || !TELEGRAM_BOT_USERNAME) return '';
  return `https://t.me/${TELEGRAM_BOT_USERNAME}/app?startapp=${encodeURIComponent(`${START_PREFIX}${id}`)}`;
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
  if (Number.isFinite(num) && num > 0) return `${Math.round(num).toLocaleString('en-US')} UAH`;
  const text = String(raw || '').trim();
  return text || 'Price on request';
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
    city: String(geo?.city || raw.location_city || '').trim(),
    district: String(geo?.district || raw.location_district || raw.location_neighborhood || '').trim(),
    neighborhood: String(geo?.neighborhood || raw.location_neighborhood || '').trim(),
    priceLabel: formatPriceLabel(raw.price_amount),
    image: images[0] || ''
  };
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

    const propIdFromPayload = parseStartPayload(ctx.startPayload);
    const propIdFromText = parseStartPayloadFromMessage(ctx.message?.text);
    const propId = propIdFromPayload || propIdFromText || null;
    const launchUrl = buildMiniAppUrl(miniAppUrl, propId);

    await setMenuButton(ctx.chat?.id);

    const inlineKeyboardMarkup = launchUrl
      ? {
          inline_keyboard: [
            [{ text: webAppButtonText, web_app: { url: launchUrl } }]
          ]
        }
      : undefined;

    const replyText = propId ? `Opening property ${propId}` : startMessage;
    await ctx.reply(replyText, inlineKeyboardMarkup ? { reply_markup: inlineKeyboardMarkup } : undefined);
  });

  bot.on('inline_query', async (ctx) => {
    try {
      const query = String(ctx.inlineQuery?.query || '').trim();
      console.log('Received inline query:', query);
      const propId = parseInlineSharePropId(query);
      if (!propId) {
        try {
          await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
        } catch (answerError) {
          console.warn('answerInlineQuery rejected (empty/no propId):', answerError?.response?.description || answerError?.message || answerError);
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

      const district = property.district || property.neighborhood || 'Odesa';
      const heading = `${property.propertyType} in ${district}`;
      const messageText = [
        `🏙 ${heading}`,
        `💰 ${property.priceLabel}`,
        `📍 ${district}`
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
      const result = imageUrl
        ? {
            type: 'photo',
            id: `share_photo_${property.id}_${Date.now()}`,
            photo_url: imageUrl,
            thumbnail_url: imageUrl,
            title: `🏙 ${heading}`,
            description: `${property.priceLabel} • ${district}`,
            caption: messageText,
            ...(maybeReplyMarkup ? { reply_markup: maybeReplyMarkup } : {})
          }
        : {
            type: 'article',
            id: `share_article_${property.id}_${Date.now()}`,
            title: `🏙 ${heading}`,
            description: `${property.priceLabel} • ${district}`,
            input_message_content: {
              message_text: messageText
            },
            ...(maybeReplyMarkup ? { reply_markup: maybeReplyMarkup } : {}),
            ...(VIA_LOGO_FALLBACK ? { thumb_url: VIA_LOGO_FALLBACK } : {})
          };

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
    await ctx.reply(
      `I heard you: ${incomingText}. Soon I will be able to answer as an AI expert.`
    );
  });

  await bot.launch();
  botInstance = bot;

  console.log('🤖 Telegram interactive bot запущен');
  return botInstance;
}

export function stopTelegramBot(signal = 'SIGTERM') {
  if (!botInstance) {
    return;
  }

  botInstance.stop(signal);
  console.log(`🤖 Telegram interactive bot остановлен (${signal})`);
  botInstance = null;
}
