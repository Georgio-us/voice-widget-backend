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

  bot.start(async (ctx) => {
    await ctx.reply(startMessage);
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
