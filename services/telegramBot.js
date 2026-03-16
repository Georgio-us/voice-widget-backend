import { Telegraf } from 'telegraf';

const startMessage =
  'Welcome to Dubai Real Estate! I am your AI assistant. How can I help you today?';

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
  const miniAppUrl = String(process.env.FRONTEND_URL || '').trim();

  bot.start(async (ctx) => {
    const inlineKeyboard = miniAppUrl
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: 'Open Catalog 🏗️', url: miniAppUrl }]]
          }
        }
      : undefined;

    await ctx.reply(startMessage, inlineKeyboard);
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
