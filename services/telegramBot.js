import { Telegraf } from 'telegraf';

const startMessage =
  'Welcome to Dubai Real Estate! I am your AI assistant. How can I help you today?';
const DEFAULT_FRONTEND_URL = 'https://voice-widget-frontend-tgdubai-split.up.railway.app/';

let botInstance = null;

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
    await setMenuButton(ctx.chat?.id);

    const inlineKeyboardMarkup = miniAppUrl
      ? {
          inline_keyboard: [
            [{ text: webAppButtonText, web_app: { url: miniAppUrl } }]
          ]
        }
      : undefined;

    await ctx.reply(startMessage, inlineKeyboardMarkup ? { reply_markup: inlineKeyboardMarkup } : undefined);
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
