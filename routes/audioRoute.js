// routes/audioRoute.js
import express from 'express';
import multer from 'multer';
import { 
  transcribeAndRespond, 
  getSessionInfo, 
  clearSession, 
  getStats 
} from '../controllers/audioController.js';

const router = express.Router();

// 🚀 Memory storage для максимальной скорости (без записи на диск)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 🚀 25MB (лимит Whisper API)
    files: 1,
    fieldSize: 25 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    // 🚀 Поддерживаемые Whisper форматы
    const allowedTypes = [
      'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/m4a',
      'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-wav'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('UNSUPPORTED_FORMAT'), false);
    }
  }
});

// 🚀 Оптимизированный обработчик ошибок
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer ошибка:', err.code);
    
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({ 
          error: 'Файл слишком большой. Максимум 25MB.',
          maxSize: '25MB'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({ error: 'Можно загрузить только один файл.' });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({ error: 'Неожиданное поле файла.' });
      default:
        return res.status(400).json({ error: 'Ошибка загрузки файла.' });
    }
  }
  
  if (err.message === 'UNSUPPORTED_FORMAT') {
    return res.status(400).json({ 
      error: 'Неподдерживаемый формат. Поддерживаются: MP3, WAV, M4A, WebM, OGG, FLAC',
      supportedFormats: ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac']
    });
  }
  
  next(err);
};

// 🚀 Middleware для логирования информации о файле
const logFileInfo = (req, res, next) => {
  if (req.file) {
    const sizeKB = (req.file.size / 1024).toFixed(1);
    const sessionId = req.body.sessionId || 'new';
    console.log(`📎 [${sessionId}] Загружен файл: ${req.file.originalname} (${sizeKB}KB, ${req.file.mimetype})`);
  }
  next();
};

// 🎤 Главный маршрут для обработки аудио
router.post('/upload', 
  upload.single('audio'), 
  handleMulterError,
  logFileInfo,
  transcribeAndRespond
);

// 🔍 Дополнительные маршруты для отладки и мониторинга

// Получить информацию о поддерживаемых форматах
router.get('/formats', (req, res) => {
  res.json({
    supportedFormats: ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac'],
    maxFileSize: '25MB',
    whisperModel: 'whisper-1',
    gptModel: 'gpt-4o-mini',
    features: [
      'Контекстные диалоги',
      'Memory storage',
      'Автоматическая очистка сессий',
      'Детальная статистика времени'
    ]
  });
});

// Получить информацию о конкретной сессии
router.get('/session/:sessionId', getSessionInfo);

// Очистить конкретную сессию
router.delete('/session/:sessionId', clearSession);

// Получить статистику всех сессий
router.get('/stats', getStats);

// 📊 Эндпоинт для проверки работоспособности аудио API
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Voice Widget Audio API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      upload: 'POST /api/audio/upload',
      formats: 'GET /api/audio/formats',
      session: 'GET /api/audio/session/:sessionId',
      clearSession: 'DELETE /api/audio/session/:sessionId',
      stats: 'GET /api/audio/stats'
    },
    optimizations: [
      'Memory storage',
      'Session context',
      'GPT-4o-mini',
      'No token limits',
      'Single OpenAI instance'
    ]
  });
});

export default router;