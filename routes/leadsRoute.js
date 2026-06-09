// routes/leadsRoute.js
// Роут для обработки лид-форм (POST /api/leads)
import express from 'express';
import { createLead } from '../services/leadsRepository.js';
import { logEvent, EventTypes } from '../services/eventLogger.js';
import { notifyLeadToTelegram } from '../services/telegramNotifier.js';
import { mirrorLeadToMediaelx } from '../services/mediaelxLeadSink.js';
import { buildLeadAiSummaryFromSessionPayload } from '../services/leadSessionEnrichment.js';
import { getPropertyByExternalId } from '../services/propertiesRepository.js';
import { pool } from '../services/db.js';

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

    const sourceTrimmed = source && typeof source === 'string' ? source.trim() : '';

    // Валидация: source обязателен
    if (!sourceTrimmed) {
      return res.status(400).json({
        ok: false,
        error: 'source is required',
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

    // Спец-поток: заявка "Хочу такой же виджет" — только нотификатор, без БД/CRM
    if (sourceTrimmed === 'widget_viral_form') {
      try {
        await notifyLeadToTelegram({
          leadId: null,
          createdAt: new Date().toISOString(),
          sessionId: sessionId || null,
          source: sourceTrimmed,
          name: (name && String(name).trim()) || 'Viral lead',
          phoneCountryCode,
          phoneNumber,
          email,
          preferredContactMethod: preferredContactMethod || null,
          language: language || 'ru',
          propertyId: null,
          consent: true,
          comment: comment || null,
          insights: null,
          lastShownCardId: null,
          aiSummary: null
        });
      } catch (tgErr) {
        console.warn('[telegram] viral lead notify failed', tgErr?.message || tgErr);
        return res.status(500).json({
          ok: false,
          error: 'INTERNAL_ERROR',
          code: 'INTERNAL_ERROR'
        });
      }

      return res.json({
        ok: true,
        routed: 'notifier_only',
        sessionId: sessionId || null
      });
    }

    // Валидация: name обязателен для основного потока заявок
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'name is required',
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

    // Read-only enrichment for Telegram/CRM (best-effort):
    // pull latest insights + last shown cardId + rich summary from session_logs (if available).
    let insightsFromSessionLog = null;
    let lastShownCardIdFromSessionLog = null;
    let richSummaryFromSessionLog = null;
    let sessionMetricsFromSessionLog = null;
    try {
      if (sessionId) {
        const r = await pool.query(
          'SELECT payload FROM session_logs WHERE session_id = $1 ORDER BY id DESC LIMIT 1',
          [sessionId]
        );
        const payload = r?.rows?.[0]?.payload || null;
        const enriched = await buildLeadAiSummaryFromSessionPayload(payload, language || 'ru');
        insightsFromSessionLog = enriched?.insights || null;
        lastShownCardIdFromSessionLog = enriched?.lastShownCardId || null;
        richSummaryFromSessionLog = enriched?.summaryText || null;
        sessionMetricsFromSessionLog = enriched?.metrics || null;
      }
    } catch {}

    const resolvedPropertyIdForMirror = (() => {
      const explicit = propertyId == null ? '' : String(propertyId).trim();
      if (explicit) return explicit;
      if (source === 'widget_in_dialog') {
        const fromSession = lastShownCardIdFromSessionLog == null ? '' : String(lastShownCardIdFromSessionLog).trim();
        if (fromSession) return fromSession;
      }
      return null;
    })();

    let propertySnapshotForMirror = null;
    try {
      if (resolvedPropertyIdForMirror) {
        propertySnapshotForMirror = await getPropertyByExternalId(resolvedPropertyIdForMirror, clientId || undefined);
      }
    } catch (propertyErr) {
      console.warn('[mediaelx] property enrichment lookup failed', propertyErr?.message || propertyErr);
    }

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
        comment,
        insights: insightsFromSessionLog,
        lastShownCardId: lastShownCardIdFromSessionLog,
        aiSummary: richSummaryFromSessionLog
      });
    } catch (tgErr) {
      // Токен НЕ логируем; ошибка не должна ломать ответ
      console.warn('[telegram] lead notify failed', tgErr?.message || tgErr);
    }

    let mediaelxStatus = null;
    // Best-effort mirror to MediaElx CRM (не ломает создание лида)
    try {
      const mirrorResult = await mirrorLeadToMediaelx({
        source,
        name,
        phoneCountryCode,
        phoneNumber,
        email,
        preferredContactMethod: preferredContactMethod || null,
        comment: comment || null,
        language: language || 'ru',
        propertyId: resolvedPropertyIdForMirror,
        propertySnapshot: propertySnapshotForMirror,
        insights: insightsFromSessionLog,
        aiSummary: richSummaryFromSessionLog,
        sessionMetrics: sessionMetricsFromSessionLog,
        lastShownCardId: lastShownCardIdFromSessionLog,
        sessionId: sessionId || null
      });
      if (mirrorResult?.deduped) {
        console.log('[mediaelx] deduped lead skipped');
        mediaelxStatus = { ok: true, status: 'deduped' };
      } else if (mirrorResult?.inserted) {
        console.log('[mediaelx] lead inserted');
        mediaelxStatus = { ok: true, status: 'inserted' };
      } else if (mirrorResult?.queued) {
        console.warn('[mediaelx] lead queued due to db unavailability');
        mediaelxStatus = { ok: false, status: 'queued', reason: mirrorResult?.reason || 'unavailable' };
      } else if (mirrorResult?.skipped) {
        console.log(`[mediaelx] skipped: ${mirrorResult.reason}`);
        mediaelxStatus = { ok: false, status: 'skipped', reason: mirrorResult?.reason || 'disabled' };
      } else if (mirrorResult?.ok === false) {
        console.warn(`[mediaelx] mirror failed: ${mirrorResult.reason || 'unknown'}`);
        mediaelxStatus = { ok: false, status: 'failed', reason: mirrorResult?.reason || 'unknown' };
      }
    } catch (mxErr) {
      console.warn('[mediaelx] mirror exception', mxErr?.message || mxErr);
      mediaelxStatus = { ok: false, status: 'exception', reason: mxErr?.message || 'unknown' };
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
      sessionId: sessionId || null,
      mediaelx: mediaelxStatus
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
