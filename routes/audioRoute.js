// routes/audioRoute.js
import express from 'express';
import multer from 'multer';
import { transcribeAndRespond } from '../controllers/audioController.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

// ✅ НОВОЕ - Улучшенная конфигурация multer с валидацией
const upload = multer({ 
  storage,
  limits: { 
    fileSize: 5 * 1024 * 1024, // ✅ ИСПРАВЛЕНО - 5MB лимит (достаточно для 60 сек)
    files: 1 // ✅ НОВОЕ - Только один файл за раз
  },
  fileFilter: (req, file, cb) => {
    // ✅ НОВОЕ - Проверка типа файла
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только аудио файлы'), false);
    }
  }
});

// ✅ НОВОЕ - Middleware для обработки ошибок multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Файл слишком большой. Максимум 5MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Можно загрузить только один файл.' });
    }
    return res.status(400).json({ error: 'Ошибка загрузки файла.' });
  }
  
  if (err.message === 'Разрешены только аудио файлы') {
    return res.status(400).json({ error: 'Разрешены только аудио файлы.' });
  }
  
  next(err);
};

router.post('/upload', upload.single('audio'), handleMulterError, transcribeAndRespond);

export default router;