// routes/telemetryRoute.js
import express from 'express';
import { logEvent } from '../services/eventLogger.js';

const router = express.Router();

/**
 * POST /api/telemetry/log
 * Принимает события телеметрии от фронтенда или бэкенда
 * 
 * Body:
 * {
 *   "eventType": "string",          // ОБЯЗАТЕЛЬНО
 *   "sessionId": "string | null",   // опционально
 *   "userId": "string | null",      // опционально
 *   "source": "string | null",     // например: "widget", "backend"
 *   "url": "string | null",         // текущий URL страницы
 *   "payload": { ... }             // произвольный JSON с деталями события
 * }
 */
router.post('/log', (req, res) => {
  try {
    const { eventType, sessionId, userId, source, url, payload } = req.body || {};

    // Валидация: eventType обязателен
    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'eventType is required'
      });
    }

    // Извлекаем IP и User-Agent из запроса
    const userIp = req.ip || 
                   req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   req.connection?.remoteAddress || 
                   null;
    const userAgent = req.headers['user-agent'] || null;

    // Логируем событие асинхронно (не блокируем ответ)
    logEvent({
      sessionId: sessionId || null,
      eventType,
      userIp,
      userAgent,
      userId: userId || null,
      source: source || null,
      url: url || null,
      payload: payload || null
    }).catch(err => {
      // Ошибка логирования не должна ломать ответ
      console.error('❌ Failed to log telemetry event:', err);
    });

    // Возвращаем успешный ответ сразу
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Telemetry route error:', err);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

export default router;
