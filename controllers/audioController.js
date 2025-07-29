// controllers/audioController.js
import { File } from 'node:buffer';
globalThis.File = File;
import { OpenAI } from 'openai';

// 🚀 Создаем единственный экземпляр OpenAI (переиспользуем соединение)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 💾 Хранилище сессий в памяти сервера
const sessions = new Map();

// 🧹 Функция очистки старых сессий (запускается каждый час)
const cleanupOldSessions = () => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      sessions.delete(sessionId);
      console.log(`🗑️ Удалена неактивная сессия: ${sessionId}`);
    }
  }
};

// Запускаем очистку каждый час
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// 🆔 Функция генерации sessionId (если не передан с фронта)
const generateSessionId = () => {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// 🗂️ Функция получения/создания сессии
const getOrCreateSession = (sessionId) => {
  if (!sessionId) {
    sessionId = generateSessionId();
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
    console.log(`✨ Создана новая сессия: ${sessionId}`);
  }

  return sessions.get(sessionId);
};

// 💬 Функция добавления сообщения в историю
const addMessageToSession = (sessionId, role, content) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.messages.push({
      role,
      content,
      timestamp: Date.now()
    });
    session.lastActivity = Date.now();
  }
};

export const transcribeAndRespond = async (req, res) => {
  const startTime = Date.now();
  let sessionId = null;
  
  try {
    // ✅ НОВОЕ - Валидация: должен быть либо файл, либо текст
    if (!req.file && !req.body.text) {
      return res.status(400).json({ error: 'Не найден аудио файл или текст сообщения' });
    }

    // 🆔 Получаем sessionId из запроса или создаем новый
    sessionId = req.body.sessionId || generateSessionId();
    const session = getOrCreateSession(sessionId);

    let transcription = '';
    let transcriptionTime = 0;

    // 🎯 НОВОЕ - Обрабатываем либо аудио, либо текст
    if (req.file) {
      // 🎤 АУДИО ОБРАБОТКА
      console.log(`📁 [${sessionId}] Получен файл: ${req.file.originalname}, размер: ${(req.file.size / 1024).toFixed(1)}KB`);

      // Создаем File объект из буфера
      const audioFile = new File([req.file.buffer], req.file.originalname, {
        type: req.file.mimetype
      });

      // Whisper транскрипция
      const transcriptionStart = Date.now();
      const whisperResponse = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'ru',
        response_format: 'text',
      });
      transcriptionTime = Date.now() - transcriptionStart;
      transcription = whisperResponse.trim();
      
      console.log(`🎤 [${sessionId}] Транскрипция завершена за ${transcriptionTime}ms`);
    } else if (req.body.text) {
      // ⌨️ ТЕКСТ ОБРАБОТКА  
      transcription = req.body.text.trim();
      console.log(`⌨️ [${sessionId}] Получен текст: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
      
      // Для текста время транскрипции = 0
      transcriptionTime = 0;
    }

    // 📝 Добавляем сообщение пользователя в историю
    addMessageToSession(sessionId, 'user', transcription);

    // 🗂️ Подготавливаем контекст для GPT (системное сообщение + история)
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

ТАКТИЧНОЕ УПРАВЛЕНИЕ БЕСЕДОЙ:
• Если клиент уходит от темы → "Интересно! А теперь давайте уточним ваш бюджет..."
• Если слишком много требований → "Понимаю пожелания. Начнем с главного..."
• Если сомневается → "Я вижу много успешных сделок. Давайте найдем ваш вариант!"

ВАЖНО: Отвечай на русском языке. Анализируй ВСЮ историю общения, а не только последнее сообщение. Будь гибким в объеме ответа — адаптируйся под реальные потребности клиента.` 
      },
      ...session.messages // Вся история диалога
    ];

    console.log(`💭 [${sessionId}] Отправляем в GPT контекст из ${session.messages.length} сообщений`);

    // 🤖 GPT ответ с оптимизированными параметрами
    const gptStart = Date.now();
    const completion = await openai.chat.completions.create({
      messages,
      model: 'gpt-4o-mini',
      temperature: 0.5,
      stream: false,
    });
    const gptTime = Date.now() - gptStart;
    console.log(`🤖 [${sessionId}] GPT ответ получен за ${gptTime}ms`);

    const botResponse = completion.choices[0].message.content.trim();

    // 📝 Добавляем ответ бота в историю
    addMessageToSession(sessionId, 'assistant', botResponse);

    const totalTime = Date.now() - startTime;
    const inputType = req.file ? 'аудио' : 'текст';
    console.log(`⏱️ [${sessionId}] Общее время обработки ${inputType}: ${totalTime}ms`);
    console.log(`📊 [${sessionId}] Активных сессий: ${sessions.size}`);

    // ✅ НОВОЕ - Возвращаем ответ с информацией о типе ввода
    res.json({
      response: botResponse,
      transcription: transcription,
      sessionId: sessionId,
      messageCount: session.messages.length,
      inputType: inputType, // 'аудио' или 'текст'
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
    const totalTime = Date.now() - startTime;
    console.error(`❌ [${sessionId || 'unknown'}] Ошибка за ${totalTime}ms:`, error.message);
    
    // Детальная обработка ошибок OpenAI
    if (error.code === 'insufficient_quota') {
      return res.status(402).json({ 
        error: 'Превышен лимит OpenAI API',
        sessionId: sessionId 
      });
    }
    
    if (error.code === 'invalid_api_key') {
      return res.status(401).json({ 
        error: 'Неверный API ключ OpenAI',
        sessionId: sessionId 
      });
    }
    
    if (error.status === 413) {
      return res.status(413).json({ 
        error: 'Аудио файл слишком большой для Whisper',
        sessionId: sessionId 
      });
    }
    
    if (error.code === 'rate_limit_exceeded') {
      return res.status(429).json({ 
        error: 'Превышен лимит запросов. Попробуйте позже.',
        sessionId: sessionId 
      });
    }

    res.status(500).json({ 
      error: 'Произошла ошибка при обработке сообщения',
      sessionId: sessionId,
      timing: { total: totalTime }
    });
  }
};

// 🔍 Функция для получения информации о сессии (для отладки)
export const getSessionInfo = async (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: 'Сессия не найдена' });
  }
  
  const session = sessions.get(sessionId);
  res.json({
    sessionId: session.sessionId,
    messageCount: session.messages.length,
    createdAt: new Date(session.createdAt).toISOString(),
    lastActivity: new Date(session.lastActivity).toISOString(),
    messages: session.messages.map(msg => ({
      role: msg.role,
      contentLength: msg.content.length,
      timestamp: new Date(msg.timestamp).toISOString()
    }))
  });
};

// 🗑️ Функция для очистки сессии (для отладки)
export const clearSession = async (req, res) => {
  const { sessionId } = req.params;
  
  if (sessions.has(sessionId)) {
    sessions.delete(sessionId);
    res.json({ message: `Сессия ${sessionId} удалена` });
  } else {
    res.status(404).json({ error: 'Сессия не найдена' });
  }
};

// 📊 Функция для получения статистики всех сессий (для отладки)
export const getStats = async (req, res) => {
  const stats = {
    totalSessions: sessions.size,
    sessions: []
  };
  
  for (const [sessionId, session] of sessions.entries()) {
    stats.sessions.push({
      sessionId,
      messageCount: session.messages.length,
      lastActivity: new Date(session.lastActivity).toISOString(),
      ageMinutes: Math.round((Date.now() - session.createdAt) / 60000)
    });
  }
  
  res.json(stats);
};