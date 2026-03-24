// routes/audioRoute.js
import express from 'express';
import multer from 'multer';
import {
  transcribeAndRespond,
  getSessionInfo,
  clearSession,
  getStats,
  handleInteraction
} from '../controllers/audioController.js';

const router = express.Router();

const normalizeTgId = (value) => String(value || '').trim();
const resolveViewerAccess = (tgUserIdRaw) => {
  const tgUserId = normalizeTgId(tgUserIdRaw);
  const superAdminId = normalizeTgId(process.env.SUPER_ADMIN_ID);
  const ownerId = normalizeTgId(process.env.OWNER_TG_ID);
  const isSuperAdmin = !!(tgUserId && superAdminId && tgUserId === superAdminId);
  const isOwner = !!(tgUserId && ownerId && tgUserId === ownerId);
  const isAdmin = isSuperAdmin || isOwner;
  return {
    accessRole: isAdmin ? (isSuperAdmin ? 'super_admin' : 'owner') : 'user',
    isAdmin,
    isSuperAdmin,
    isOwner
  };
};

// 🚀 Memory storage для максимальной скорости
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB (лимит Whisper API)
    files: 1,
    fieldSize: 25 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
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

// 🔧 Обработчик ошибок Multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer ошибка:', err.code);
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({ error: 'Файл слишком большой. Максимум 25MB.' });
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

// 🛡️ Валидация входных данных
const validateInput = (req, res, next) => {
  // Валидация текста
  if (req.body.text) {
    if (typeof req.body.text !== 'string') {
      return res.status(400).json({ 
        error: 'Текст должен быть строкой',
        code: 'INVALID_TEXT_TYPE'
      });
    }
    
    if (req.body.text.length > 2000) {
      return res.status(400).json({ 
        error: 'Текст слишком длинный (максимум 2000 символов)',
        code: 'TEXT_TOO_LONG',
        maxLength: 2000,
        currentLength: req.body.text.length
      });
    }
    
    if (req.body.text.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Текст не может быть пустым',
        code: 'EMPTY_TEXT'
      });
    }
  }

  // Валидация sessionId (если передан)
  if (req.body.sessionId) {
    if (typeof req.body.sessionId !== 'string') {
      return res.status(400).json({ 
        error: 'SessionId должен быть строкой',
        code: 'INVALID_SESSION_TYPE'
      });
    }
    
    if (!/^user_\d+_[a-z0-9]+$/.test(req.body.sessionId)) {
      return res.status(400).json({ 
        error: 'Некорректный формат sessionId',
        code: 'INVALID_SESSION_FORMAT'
      });
    }
  }

  // Проверка на наличие либо аудио, либо текста
  if (!req.file && !req.body.text) {
    return res.status(400).json({ 
      error: 'Необходимо отправить аудиофайл или текст',
      code: 'NO_INPUT_PROVIDED'
    });
  }

  console.log(`✅ Валидация пройдена для session: ${req.body.sessionId?.slice(-8) || 'new'}`);
  next();
};

// 🔍 Лог загруженного файла
const logFileInfo = (req, res, next) => {
  if (req.file) {
    const sizeKB = (req.file.size / 1024).toFixed(1);
    const sessionId = req.body.sessionId || 'new';
    console.log(`📎 [${sessionId}] Загружен файл: ${req.file.originalname} (${sizeKB}KB, ${req.file.mimetype})`);
  }
  next();
};

// 🎤 Главный маршрут: аудио + обработка
router.post('/upload',
  upload.single('audio'),
  handleMulterError,
  validateInput, // ← Добавлена валидация
  logFileInfo,
  transcribeAndRespond
);

// 📌 Получить информацию о сессии
router.get('/session/:sessionId', getSessionInfo);

// 🔐 Получить роль доступа для UI (admin/wishlist switch in header)
router.get('/access', (req, res) => {
  try {
    const tgUserId = normalizeTgId(req.query?.tgUserId);
    const access = resolveViewerAccess(tgUserId);
    res.json({
      ok: true,
      tgUserId: tgUserId || null,
      ...access
    });
  } catch (error) {
    console.error('❌ /api/audio/access error:', error);
    res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR'
    });
  }
});

// 🧹 Очистить конкретную сессию
router.delete('/session/:sessionId', clearSession);

// 📈 Получить статистику всех сессий
router.get('/stats', getStats);

// 🔁 Взаимодействие с карточками (like/next)
router.post('/interaction', handleInteraction);

// 📋 Поддерживаемые форматы и фичи
router.get('/formats', (req, res) => {
  res.json({
    supportedFormats: ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac'],
    maxFileSize: '25MB',
    whisperModel: 'whisper-1',
    gptModel: 'gpt-4o-mini',
    features: [
      'Контекстные диалоги',
      'Memory storage',
      'Автоочистка сессий',
      'Извлечение ключевых параметров (имя, район, бюджет...)',
      'Статистика сессий',
      'Валидация входных данных' // ← Добавлено
    ]
  });
});

// 🧪 Проверка работоспособности API
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Voice Widget Audio API',
    version: '2.1.0', // ← Обновлена версия
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
      'Single OpenAI instance',
      'Input validation' // ← Добавлено
    ]
  });
});

export default router;
