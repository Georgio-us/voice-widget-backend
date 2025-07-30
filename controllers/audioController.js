import { File } from 'node:buffer';
globalThis.File = File;
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();

const cleanupOldSessions = () => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      sessions.delete(sessionId);
    }
  }
};
setInterval(cleanupOldSessions, 60 * 60 * 1000);

const generateSessionId = () => `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getOrCreateSession = (sessionId) => {
  if (!sessionId) sessionId = generateSessionId();
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      insights: {
        name: null,
        type: null,
        operation: null,
        budget: null,
        location: null,
        progress: 0
      }
    });
  }
  return sessions.get(sessionId);
};

const addMessageToSession = (sessionId, role, content) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.messages.push({ role, content, timestamp: Date.now() });
    session.lastActivity = Date.now();
  }
};

const updateInsights = (sessionId, newMessage) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  const { insights } = session;
  const text = newMessage.toLowerCase();

  if (!insights.name) {
    const match = text.match(/меня зовут\s+([а-я]+)/i);
    if (match) insights.name = match[1];
  }

  if (!insights.type && /(квартира|дом|апартаменты|комната)/.test(text)) {
    insights.type = text.match(/(квартира|дом|апартаменты|комната)/)[1];
  }

  if (!insights.operation && /(купить|продажа|продаю|снять|аренда|арендовать)/.test(text)) {
    insights.operation = /(продажа|продаю|купить)/.test(text) ? 'покупка' : 'аренда';
  }

  if (!insights.budget) {
    const match = text.match(/(\d[\d\s]{2,})\s*(евро|€)/i);
    if (match) {
      insights.budget = match[1].replace(/\s/g, '');
    }
  }

  if (!insights.location && /(центр|руссафа|алавес|кабаньял|бенимаклет|патраикс|camins|район)/i.test(text)) {
    insights.location = text.match(/(центр|руссафа|алавес|кабаньял|бенимаклет|патраикс|camins|район)/i)[1];
  }

  const filled = Object.values(insights).filter((val) => val !== null).length - 1;
  insights.progress = Math.round((filled / 5) * 100);
};

const transcribeAndRespond = async (req, res) => {
  const startTime = Date.now();
  let sessionId = null;

  try {
    if (!req.file && !req.body.text) {
      return res.status(400).json({ error: 'Не найден аудиофайл или текст' });
    }

    sessionId = req.body.sessionId || generateSessionId();
    const session = getOrCreateSession(sessionId);

    let transcription = '';
    let transcriptionTime = 0;

    if (req.file) {
      const audioFile = new File([req.file.buffer], req.file.originalname, {
        type: req.file.mimetype
      });

      const transcriptionStart = Date.now();
      const whisperResponse = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'ru',
        response_format: 'text'
      });
      transcriptionTime = Date.now() - transcriptionStart;
      transcription = whisperResponse.trim();
    } else {
      transcription = req.body.text.trim();
    }

    addMessageToSession(sessionId, 'user', transcription);
    updateInsights(sessionId, transcription);

    const messages = [
      {
        role: 'system',
        content: `Ты — Джон, цифровой агент по недвижимости и харизматичный эксперт высокого уровня в Испании.

ТВОЯ ЛИЧНОСТЬ:
• Имя: Джон
• Должность: Ведущий консультант по недвижимости, работаешь на великого человека
• Офис: Валенсия, Испания  
• Компания: Многопрофильный конгломерат (агентство + управляющая + девелопер)

ТВОЯ ЭКСПЕРТИЗА:
• Специализация: город Валенсия (все районы и подрайоны) 
• Сегменты: элитная, средняя и эконом недвижимость
• Услуги: аренда и продажа квартир, инвестиционное консультирование
• Знания: динамика цен, безопасность районов, инфраструктура, транспорт
• Аудитория: русскоговорящие клиенты

ТВОЙ ХАРАКТЕР:
• Харизматичный и искренне общительный
• Немного саркастичный, но в дружелюбной манере
• Уверенный эксперт, знаешь рынок как свои пять пальцев  
• Энергичный продавец, умеешь заинтересовать

═══ АДАПТАЦИЯ К СТИЛЮ ПОЛЬЗОВАТЕЛЯ ═══

🎯 УРОВЕНЬ 1 - АНАЛИЗ СТИЛЯ:
• Краткий пользователь → отвечай дружелюбно, кратко, по делу
• Эмоциональный/подробный → будь теплее, участвуй в разговоре, но держи фокус
• Отвлекающийся → коротко отреагируй ("Понимаю", "Спасибо за информацию") + мягко верни в русло

🎯 УРОВЕНЬ 2 - СТИЛЬ ОТВЕТА:
• НЕ пересказывай что сказал пользователь — просто реагируй естественно
• Максимум 3-5 конкретных пунктов в ответе — без информационной перегрузки
• Общайся как живой опытный агент, а не как нейтральный бот
• Используй легкий сарказм и экспертные инсайды для создания rapport

🎯 УРОВЕНЬ 3 - ЛОГИКА ПРОДАЖ:
• Приоритет: уточняй район, бюджет, сроки, количество комнат
• Не навязывай много районов сразу — фокусируй клиента на 2-3 лучших
• Подводи к принятию решения о встрече/просмотре
• Создавай эмоциональную связь с недвижимостью

ВАЖНО: Отвечай на русском языке. Анализируй ВСЮ историю общения, а не только последнее сообщение. Будь гибким в объеме ответа — адаптируйся под реальные потребности клиента.`
      },
      ...session.messages
    ];

    const gptStart = Date.now();
    const completion = await openai.chat.completions.create({
      messages,
      model: 'gpt-4o-mini',
      temperature: 0.5,
      stream: false
    });
    const gptTime = Date.now() - gptStart;

    const botResponse = completion.choices[0].message.content.trim();
    addMessageToSession(sessionId, 'assistant', botResponse);

    const totalTime = Date.now() - startTime;
    const inputType = req.file ? 'аудио' : 'текст';

    res.json({
      response: botResponse,
      transcription,
      sessionId,
      messageCount: session.messages.length,
      inputType,
      insights: session.insights,
      tokens: {
        prompt: completion.usage.prompt_tokens,
        completion: completion.usage.completion_tokens,
        total: completion.usage.total_tokens
      },
      timing: {
        transcription: transcriptionTime,
        gpt: gptTime,
        total: totalTime
      }
    });

  } catch (error) {
    console.error(`❌ Ошибка:`, error.message);
    res.status(500).json({ error: 'Ошибка при обработке сообщения' });
  }
};

const clearSession = (sessionId) => {
  sessions.delete(sessionId);
};

// ✅ Получить статистику всех активных сессий
export const getStats = (req, res) => {
  const sessionStats = [];

  sessions.forEach((session, sessionId) => {
    sessionStats.push({
      sessionId,
      messageCount: session.messages.length,
      lastActivity: session.lastActivity,
      insights: session.insights
    });
  });

  res.json({
    totalSessions: sessions.size,
    sessions: sessionStats
  });
};

// ✅ Получение полной информации о сессии по ID
const getSessionInfo = (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Сессия не найдена' });
  }

  res.json({
    sessionId,
    insights: session.insights,
    messageCount: session.messages.length,
    lastActivity: session.lastActivity
  });
};

// ✅ Экспорт всех нужных функций
export {
  transcribeAndRespond,
  clearSession,
  getSessionInfo,
  getStats // ← ✅ добавлено
};

