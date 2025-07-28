// index.js
import dotenv from 'dotenv';
dotenv.config(); // 👈 просто так — и всё заработает!

if (process.env.OPENAI_API_KEY) {
  console.log('✅ OpenAI API key loaded successfully');
} else {
  console.warn('⚠️ OpenAI API key is missing!');
}

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import audioRouter from './routes/audioRoute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ✅ НОВОЕ - Улучшенная CORS конфигурация
app.use(cors({
  origin: process.env.FRONTEND_URL || true, // Можно указать конкретный домен в .env
  credentials: true,
  optionsSuccessStatus: 200
}));

// ✅ НОВОЕ - Увеличенный лимит для JSON (на случай больших данных)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ НОВОЕ - Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// API роуты
app.use('/api/audio', audioRouter);

// ✅ НОВОЕ - 404 обработчик для неизвестных маршрутов
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Маршрут не найден',
    path: req.originalUrl,
    method: req.method
  });
});

// ✅ НОВОЕ - Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error('🚨 Необработанная ошибка:', err);
  
  // Не показываем детали ошибок в продакшене
  const isDev = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: 'Внутренняя ошибка сервера',
    ...(isDev && { details: err.message, stack: err.stack })
  });
});

// ✅ НОВОЕ - Обработка необработанных исключений
process.on('uncaughtException', (err) => {
  console.error('🚨 Необработанное исключение:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('🚨 Необработанное отклонение промиса:', err);
  process.exit(1);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 ================================');
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
  console.log(`📋 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`🎤 Audio API: http://0.0.0.0:${PORT}/api/audio/upload`);
  console.log('🚀 ================================');
});