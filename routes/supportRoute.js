// routes/supportRoute.js
// Роут для обработки тикетов поддержки (POST /api/support)
import express from 'express';
import { createSupportRequest } from '../services/supportRepository.js';

const router = express.Router();

/**
 * POST /api/support
 * Создаёт новый тикет поддержки в таблице support_requests
 * 
 * Body:
 * {
 *   "sessionId": "user_...",           // опционально
 *   "clientId": "demo",                 // опционально, по умолчанию 'demo'
 *   "problemType": "Lead not received", // обязателен
 *   "message": "Issue description...",  // обязателен
 *   "language": "ru",                   // опционально
 *   "extra": {                          // опционально
 *     "userAgent": "...",
 *     "widgetVersion": "v1",
 *     "url": "..."
 *   }
 * }
 * 
 * Response (success):
 * {
 *   "ok": true,
 *   "id": 123,
 *   "createdAt": "2024-01-01T12:00:00.000Z",
 *   "sessionId": "user_..." | null
 * }
 * 
 * Response (error):
 * {
 *   "ok": false,
 *   "error": "MESSAGE",
 *   "code": "VALIDATION_ERROR" | "INTERNAL_ERROR"
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { sessionId, clientId, problemType, message, language, extra } = req.body || {};

    // Базовая проверка: message и problemType не пустые (после trim)
    const messageTrimmed = message ? String(message).trim() : '';
    const problemTypeTrimmed = problemType ? String(problemType).trim() : '';

    if (messageTrimmed.length === 0 || problemTypeTrimmed.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'message and problemType are required',
        code: 'VALIDATION_ERROR'
      });
    }

    // Вызываем createSupportRequest из репозитория
    const result = await createSupportRequest({
      sessionId: sessionId || null,
      clientId,
      problemType: problemTypeTrimmed,
      message: messageTrimmed,
      language: language || null,
      extra: extra || {}
    });

    // Возвращаем успешный ответ
    res.json({
      ok: true,
      id: result.id,
      createdAt: result.createdAt,
      sessionId: sessionId || null
    });

  } catch (err) {
    console.error('❌ Error in POST /api/support:', err);

    // Если это ошибка валидации из createSupportRequest, возвращаем 400
    if (err.message && (
      err.message.includes('is required') ||
      err.message.includes('must be')
    )) {
      return res.status(400).json({
        ok: false,
        error: err.message,
        code: 'VALIDATION_ERROR'
      });
    }

    // Для всех остальных ошибок возвращаем 500
    res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      code: 'INTERNAL_ERROR'
    });
  }
});

export default router;

