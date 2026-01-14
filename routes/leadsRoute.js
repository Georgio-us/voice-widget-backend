// routes/leadsRoute.js
// Роут для обработки лид-форм (POST /api/leads)
import express from 'express';
import { createLead } from '../services/leadsRepository.js';
import { logEvent, EventTypes } from '../services/eventLogger.js';
import { notifyLeadToTelegram } from '../services/telegramNotifier.js';

const router = express.Router();

/**
 * POST /api/leads
 * Создаёт новый лид в таблице lead_requests
 * 
 * Body:
 * {
 *   "sessionId": "user_...",
 *   "clientId": "demo",                // опционально, по умолчанию 'demo'
 *   "source": "widget_full_form",      // обязателен
 *   "name": "John Doe",                 // обязателен
 *   "phoneCountryCode": "+34",          // опционально
 *   "phoneNumber": "612345678",         // опционально, но хотя бы phoneNumber или email
 *   "email": "john@example.com",        // опционально, но хотя бы phoneNumber или email
 *   "preferredContactMethod": "whatsapp", // опционально
 *   "comment": "short note",            // опционально
 *   "language": "ru",                   // обязателен
 *   "propertyId": "A017",               // опционально
 *   "consent": true                     // обязателен, должен быть true
 * }
 * 
 * Response (success):
 * {
 *   "ok": true,
 *   "leadId": 123,
 *   "createdAt": "2024-01-01T12:00:00.000Z",
 *   "sessionId": "user_..."
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
    const {
      sessionId,
      clientId,
      source,
      name,
      phoneCountryCode,
      phoneNumber,
      email,
      preferredContactMethod,
      comment,
      language,
      propertyId,
      consent
    } = req.body || {};

    // Валидация: name обязателен
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'name is required',
        code: 'VALIDATION_ERROR'
      });
    }

    // Валидация: consent обязан быть true
    if (consent !== true) {
      return res.status(400).json({
        ok: false,
        error: 'consent must be true to create a lead',
        code: 'VALIDATION_ERROR'
      });
    }

    // Валидация: хотя бы один из phoneNumber или email должен быть заполнен
    const phoneNumberTrimmed = phoneNumber ? String(phoneNumber).trim() : '';
    const emailTrimmed = email ? String(email).trim() : '';
    if (phoneNumberTrimmed.length === 0 && emailTrimmed.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'at least one of phoneNumber or email must be provided',
        code: 'VALIDATION_ERROR'
      });
    }

    // Валидация: source обязателен
    if (!source || typeof source !== 'string' || source.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'source is required',
        code: 'VALIDATION_ERROR'
      });
    }

    // Вызываем createLead из репозитория
    // Валидация внутри createLead тоже есть, но здесь мы уже проверили основные поля
    const result = await createLead({
      sessionId: sessionId || null,
      clientId,
      source,
      name,
      phoneCountryCode,
      phoneNumber,
      email,
      preferredContactMethod,
      comment,
      language: language || 'ru',
      propertyId,
      consent,
      extra: null // пока не используем
    });

    // Best-effort Telegram notify (не ломает создание лида)
    try {
      await notifyLeadToTelegram({
        leadId: result.id,
        createdAt: result.created_at,
        sessionId: sessionId || null,
        source,
        name,
        phoneCountryCode,
        phoneNumber,
        email,
        preferredContactMethod,
        language: language || 'ru',
        propertyId: propertyId || null,
        consent,
        comment
      });
    } catch (tgErr) {
      // Токен НЕ логируем; ошибка не должна ломать ответ
      console.warn('[telegram] lead notify failed', tgErr?.message || tgErr);
    }

    // Логируем событие в телеметрию (если есть EventTypes.LEAD_FORM_SUBMIT)
    try {
      const userIp = req.ip || 
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     req.connection?.remoteAddress || 
                     null;
      const userAgent = req.headers['user-agent'] || null;

      await logEvent({
        sessionId: sessionId || null,
        eventType: EventTypes.LEAD_FORM_SUBMIT,
        userIp,
        userAgent,
        source: 'backend',
        payload: {
          leadId: result.id,
          source,
          language: language || 'ru',
          propertyId: propertyId || null,
          hasPhone: !!phoneNumberTrimmed,
          hasEmail: !!emailTrimmed,
          preferredContactMethod: preferredContactMethod || null
        }
      });
    } catch (telemetryErr) {
      // Ошибка логирования не должна ломать ответ
      console.error('❌ Failed to log lead_form_submit event:', telemetryErr);
    }

    // Возвращаем успешный ответ
    res.json({
      ok: true,
      leadId: result.id,
      createdAt: result.created_at,
      sessionId: sessionId || null
    });

  } catch (err) {
    console.error('❌ Error in POST /api/leads:', err);

    // Если это ошибка валидации из createLead, возвращаем 400
    if (err.message && (
      err.message.includes('is required') ||
      err.message.includes('must be') ||
      err.message.includes('at least one')
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

