import { Telegraf } from 'telegraf';
import { getPropertyByExternalId } from './propertiesRepository.js';

const startMessage =
  'Welcome to Dubai Real Estate! I am your AI assistant. How can I help you today?';
const DEFAULT_FRONTEND_URL = 'https://voice-widget-frontend-tgdubai-split.up.railway.app/';
const START_PREFIX = 'prop_';
const INLINE_SHARE_PREFIX = 'share_prop_';
const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || 'viaproperties_bot').replace(/^@/, '');

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
  if (Number.isFinite(num) && num > 0) return `${Math.round(num).toLocaleString('en-US')} AED`;
  const text = String(raw || '').trim();
  return text || 'Price on request';
}

async function getPropertyForInlineShare(propId) {
  const raw = await getPropertyByExternalId(propId);
  if (!raw) return null;
  const images = parseImages(raw.images);
  return {
    id: normalizePropId(raw.external_id || raw.id),
    title: String(raw.title || '').trim(),
    propertyType: String(raw.property_type || 'property').trim(),
    city: String(raw.location_city || '').trim(),
    district: String(raw.location_district || raw.location_neighborhood || '').trim(),
    neighborhood: String(raw.location_neighborhood || '').trim(),
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
      const propId = parseInlineSharePropId(query);
      if (!propId) {
        await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
        return;
      }

      const property = await getPropertyForInlineShare(propId);
      if (!property) {
        await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
        return;
      }

      const district = property.district || property.neighborhood || 'Dubai';
      const heading = `${property.propertyType} in ${district}`;
      const messageText = [
        `🏙 ${heading}`,
        `💰 ${property.priceLabel}`,
        `📍 ${district}`
      ].join('\n');

      const miniAppDeepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}/app?startapp=${encodeURIComponent(`${START_PREFIX}${property.id}`)}`;
      const result = {
        type: 'article',
        id: `share_${property.id}`,
        title: `🏙 ${heading}`,
        description: `${property.priceLabel} • ${district}`,
        input_message_content: {
          message_text: messageText
        },
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Смотреть объект', url: miniAppDeepLink }]
          ]
        }
      };
      if (property.image) {
        result.thumb_url = property.image;
      }

      await ctx.answerInlineQuery([result], { cache_time: 0, is_personal: true });
    } catch (error) {
      console.warn('inline_query handling failed:', error?.message || error);
      try { await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true }); } catch {}
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
