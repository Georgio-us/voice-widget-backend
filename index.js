// index.js
import dotenv from 'dotenv';
dotenv.config();

// Проверяем наличие OpenAI API ключа
if (process.env.OPENAI_API_KEY) {
  console.log('✅ OpenAI API key loaded successfully');
} else {
  console.error('❌ OPENAI_API_KEY не найден в переменных окружения!');
  process.exit(1);
}

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import audioRouter from './routes/audioRoute.js';
import cardRouter from './routes/cardRoute.js';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3001;

// ТУТ ИНФОРМАЦИЯ О ДОМЕНАХ СЕРВЕРАХ И КОРС:
app.use(cors({
  origin: function (origin, callback) {
    // Разрешаем запросы без origin (Postman, мобильные приложения)
    if (!origin) return callback(null, true);
    
    // Для development - разрешаем все localhost и 127.0.0.1
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Продакшен домены
    const allowedOrigins = [
      'https://georgio-us.github.io/Voice-Widget-Frontend/',  // ← Полный путь!
      'https://georgio-us.github.io',  // ← На всякий случай и основной домен
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    callback(null, true); // Для development разрешаем все
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// 🚀 Middleware для парсинга (уменьшенные лимиты, так как аудио через multer)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 📦 Раздача статических ассетов (изображения карточек)
app.use('/static', express.static('public'));
// Раздаём изображения из data/properties как /static/properties
app.use('/static/properties', express.static(join(__dirname, 'data/properties')));

// 🚀 Middleware для логирования запросов и времени ответа
app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(data) {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? '🔴' : res.statusCode >= 300 ? '🟡' : '🟢';
    console.log(`${statusColor} ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    return originalSend.call(this, data);
  };
  
  next();
});

// 📊 Главный health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Voice Widget Backend',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    node_version: process.version,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
    },
    apis: {
      openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing'
    }
  });
});

// 🎤 API роуты
app.use('/api/audio', audioRouter);
app.use('/api/cards', cardRouter);

// 🔍 Корневой маршрут с информацией об API
app.get('/', (req, res) => {
  res.json({
    message: 'Voice Widget Backend API v2.0.0',
    documentation: {
      health: 'GET /health',
      audio_upload: 'POST /api/audio/upload',
      audio_formats: 'GET /api/audio/formats', 
      audio_health: 'GET /api/audio/health',
      audio_stats: 'GET /api/audio/stats'
    },
    features: [
      'Whisper speech-to-text',
      'GPT-4o-mini responses',
      'Session-based context',
      'Memory storage',
      'Real-time performance metrics'
    ],
    optimizations: [
      'Removed summary generation',
      'Memory-only file storage',
      'Single OpenAI client instance',
      'No token limits',
      'Automatic session cleanup'
    ]
  });
});

// 🚫 404 обработчик для неизвестных маршрутов
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Маршрут не найден',
    path: req.originalUrl,
    method: req.method,
    available_endpoints: [
      'GET /',
      'GET /health', 
      'POST /api/audio/upload',
      'GET /api/audio/formats',
      'GET /api/audio/health'
    ]
  });
});

// 🚨 Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error('🚨 Необработанная ошибка:', err);
  
  const isDev = process.env.NODE_ENV !== 'production';
  const errorResponse = {
    error: 'Внутренняя ошибка сервера',
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method
  };
  
  // В режиме разработки показываем детали ошибки
  if (isDev) {
    errorResponse.details = err.message;
    errorResponse.stack = err.stack;
  }
  
  res.status(err.status || 500).json(errorResponse);
});

// 🚀 Graceful shutdown обработчики
process.on('SIGTERM', () => {
  console.log('👋 Получен сигнал SIGTERM, завершаем сервер...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Получен сигнал SIGINT (Ctrl+C), завершаем сервер...');
  process.exit(0);
});

// 🚨 Обработка необработанных исключений
process.on('uncaughtException', (err) => {
  console.error('🚨 Необработанное исключение:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('🚨 Необработанное отклонение промиса:', err);
  process.exit(1);
});

// 🚀 Запускаем сервер
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 ================================');
  console.log(`✅ Voice Widget Backend запущен!`);
  console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
  console.log(`📋 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`🎤 Audio API: http://0.0.0.0:${PORT}/api/audio/upload`);
  console.log(`📊 Audio stats: http://0.0.0.0:${PORT}/api/audio/stats`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚡ Optimizations: Memory storage, GPT-4o-mini, Session context`);
  console.log('🚀 ================================');
});