// routes/leadsRoute.js
// Роут для обработки лид-форм (POST /api/leads)
import express from 'express';
import { createLead } from '../services/leadsRepository.js';
import { logEvent, EventTypes } from '../services/eventLogger.js';
import { notifyLeadToTelegram } from '../services/telegramNotifier.js';
import { notifyLeadToProjectTelegram } from '../services/projectTelegramNotifier.js';
import { pool } from '../services/db.js';
import { getPropertyByExternalId } from '../services/propertiesRepository.js';

const router = express.Router();
const isWantBotSource = (value) => String(value || '').trim().toLowerCase().startsWith('guest_want_bot');

const formatMoney = (amount, currency = 'USD') => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.round(n).toLocaleString('en-US')} ${String(currency || 'USD').trim() || 'USD'}`;
};

const formatPropertyOperationUa = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'rent') return 'оренда';
  if (v === 'sale') return 'продаж';
  return v || 'обʼєкт';
};

const formatPropertyTypeUa = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (['apartment', 'flat'].includes(v)) return 'квартира';
  if (v === 'house') return 'будинок';
  if (v === 'land') return 'ділянка';
  if (v === 'commercial') return 'комерція';
  return v || 'нерухомість';
};

const buildPropertyLeadSummary = (row) => {
  if (!row) return null;
  const geo = row.geo && typeof row.geo === 'object' ? row.geo : {};
  const externalId = String(row.external_id || '').trim();
  const title = String(row.title || '').trim();
  const district = String(geo.district || row.location_district || '').trim();
  const neighborhood = String(geo.neighborhood || row.location_neighborhood || '').trim();
  const roomsRaw = Number(row.specs_rooms || 0);
  const rooms = Number.isFinite(roomsRaw) && roomsRaw > 0 ? `${roomsRaw} кімн.` : '';
  const areaRaw = Number(row.specs_area_m2 || 0);
  const area = Number.isFinite(areaRaw) && areaRaw > 0 ? `${areaRaw} м²` : '';
  const price = formatMoney(row.price_amount, row.price_currency);
  const parts = [
    formatPropertyOperationUa(row.operation),
    formatPropertyTypeUa(row.property_type),
    district,
    neighborhood,
    rooms,
    area,
    price
  ].filter(Boolean);
  return {
    id: externalId,
    title,
    summary: parts.join(' · ')
  };
};

const buildPropertyDeepLink = (propertyId) => {
  const id = String(propertyId || '').trim();
  if (!id) return '';
  const botUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim();
  if (botUsername) {
    return `https://t.me/${botUsername}/app?startapp=${encodeURIComponent(`prop_${id}`)}`;
  }
  const base = String(process.env.FRONTEND_URL || '').trim();
  if (!base) return '';
  try {
    const url = new URL(base);
    url.searchParams.set('propId', id);
    return url.toString();
  } catch {
    return `${base.replace(/\/+$/, '')}/?propId=${encodeURIComponent(id)}`;
  }
};

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
      telegramUsername,
      tgUserId,
      preferredContactMethod,
      comment,
      language,
      propertyId,
      consent
    } = req.body || {};
    const effectiveClientId =
      String(clientId || process.env.BOT_CLIENT_ID || process.env.CLIENT_ID || 'demo').trim() || 'demo';

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

    // Валидация: хотя бы один контакт (phone/email/telegram) должен быть заполнен
    const phoneNumberTrimmed = phoneNumber ? String(phoneNumber).trim() : '';
    const emailTrimmed = email ? String(email).trim() : '';
    const telegramUsernameTrimmed = telegramUsername ? String(telegramUsername).trim() : '';
    const tgUserIdTrimmed = tgUserId === null || tgUserId === undefined ? '' : String(tgUserId).trim();
    const normalizedSource = String(source || '').trim().toLowerCase();
    const telegramContactOk =
      ((normalizedSource === 'tg_mini_app' || normalizedSource === 'tg_header_main' || normalizedSource === 'tg_property_card') ||
        String(preferredContactMethod || '').toLowerCase() === 'telegram') &&
      telegramUsernameTrimmed.length > 0;
    if (phoneNumberTrimmed.length === 0 && emailTrimmed.length === 0 && !telegramContactOk) {
      return res.status(400).json({
        ok: false,
        error: 'at least one contact (phone, email or telegram) must be provided',
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
      clientId: effectiveClientId,
      source,
      name,
      phoneCountryCode,
      phoneNumber,
      email,
      preferredContactMethod,
      comment,
      language: language || 'ua',
      propertyId,
      consent,
      telegramUsername: telegramUsernameTrimmed || null,
      extra: telegramContactOk
        ? { telegramUsername: telegramUsernameTrimmed, ...(tgUserIdTrimmed ? { tgUserId: tgUserIdTrimmed } : {}) }
        : (tgUserIdTrimmed ? { tgUserId: tgUserIdTrimmed } : null)
    });

    // Read-only enrichment for Telegram notification (best-effort):
    // pull latest insights + last shown cardId from session_logs (if available).
    let insightsFromSessionLog = null;
    let lastShownCardIdFromSessionLog = null;
    try {
      if (sessionId) {
        const r = await pool.query(
          'SELECT payload FROM session_logs WHERE session_id = $1',
          [sessionId]
        );
        const payload = r?.rows?.[0]?.payload || null;
        const messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
        // latest insights (meta.insights) from the end
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          const ins = m?.meta?.insights;
          if (ins && typeof ins === 'object' && !Array.isArray(ins)) {
            insightsFromSessionLog = ins;
            break;
          }
        }
        // last shown card id from logged assistant cards[] (from the end)
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          const cards = Array.isArray(m?.cards) ? m.cards : [];
          const id = cards?.[0]?.id || null;
          if (id) {
            lastShownCardIdFromSessionLog = String(id);
            break;
          }
        }
      }
    } catch {}

    let propertyLeadSummary = null;
    let propertyLeadUrl = '';
    try {
      const idForSummary = String(propertyId || lastShownCardIdFromSessionLog || '').trim();
      if (idForSummary) {
        const row = await getPropertyByExternalId(idForSummary, effectiveClientId);
        propertyLeadSummary = buildPropertyLeadSummary(row);
        propertyLeadUrl = buildPropertyDeepLink(propertyLeadSummary?.id || idForSummary);
      }
    } catch {}

    // Best-effort Telegram notify (не ломает создание лида)
    try {
      await notifyLeadToTelegram({
        leadId: result.id,
        createdAt: result.created_at,
        sessionId: sessionId || null,
        source,
        telegramUsername: telegramUsernameTrimmed || null,
        tgUserId: tgUserIdTrimmed || null,
        name,
        phoneCountryCode,
        phoneNumber,
        email,
        preferredContactMethod,
        language: language || 'ua',
        propertyId: propertyId || null,
        consent,
        comment,
        insights: insightsFromSessionLog,
        lastShownCardId: lastShownCardIdFromSessionLog,
        propertySummary: propertyLeadSummary,
        propertyUrl: propertyLeadUrl || null
      });
    } catch (tgErr) {
      // Токен НЕ логируем; ошибка не должна ломать ответ
      console.warn('[telegram] lead notify failed', tgErr?.message || tgErr);
    }
    if (!isWantBotSource(source)) {
      try {
        await notifyLeadToProjectTelegram({
          leadId: result.id,
          createdAt: result.created_at,
          sessionId: sessionId || null,
          source,
          telegramUsername: telegramUsernameTrimmed || null,
          tgUserId: tgUserIdTrimmed || null,
          name,
          phoneCountryCode,
          phoneNumber,
          email,
          preferredContactMethod,
          language: language || 'ua',
          propertyId: propertyId || null,
          consent,
          comment,
          insights: insightsFromSessionLog,
          lastShownCardId: lastShownCardIdFromSessionLog,
          propertySummary: propertyLeadSummary,
          propertyUrl: propertyLeadUrl || null
        });
      } catch (projectTgErr) {
        console.warn('[telegram-project] lead notify failed', projectTgErr?.message || projectTgErr);
      }
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
          clientId: effectiveClientId,
          source,
          language: language || 'ua',
          propertyId: propertyId || null,
          hasPhone: !!phoneNumberTrimmed,
          hasEmail: !!emailTrimmed,
          hasTelegram: !!telegramContactOk,
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
