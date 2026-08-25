import express from 'express';
import { notifyLeadToProjectTelegram } from '../services/projectTelegramNotifier.js';

const router = express.Router();

const text = (value, limit = 4000) => String(value ?? '').trim().slice(0, limit);

const metaValue = (meta, key) => text(meta?.[key], 500);

const readCommentField = (comment, label) => {
  const prefix = `${label}:`;
  const line = String(comment || '')
    .split(/\r?\n/)
    .find((value) => String(value).trim().startsWith(prefix));
  return line ? String(line).trim().slice(prefix.length).trim() : '';
};

const readMetaFromComment = (comment) => ({
  leadId: readCommentField(comment, 'Meta Lead ID'),
  campaignName: readCommentField(comment, 'Кампания'),
  adsetName: readCommentField(comment, 'Ad set'),
  adName: readCommentField(comment, 'Объявление'),
  formName: readCommentField(comment, 'Форма'),
  purchasePlan: readCommentField(comment, 'Когда планирует покупку'),
  installments: readCommentField(comment, 'Нужна рассрочка')
});

const buildMetaLeadTelegramMessage = ({ name, phoneNumber, createdAt, meta = {} }) => {
  const lines = ['🏠✨ НОВАЯ ЗАЯВКА ИЗ META', ''];
  const add = (label, value) => {
    const safe = text(value, 800);
    if (safe && safe !== '-') lines.push(`${label}: ${safe}`);
  };

  lines.push('👤 Клиент');
  lines.push(name);
  lines.push('');
  lines.push('📞 Телефон');
  lines.push(phoneNumber);
  lines.push('');

  const campaign = metaValue(meta, 'campaignName');
  const adset = metaValue(meta, 'adsetName');
  const ad = metaValue(meta, 'adName');
  const form = metaValue(meta, 'formName');
  if (campaign || adset || ad || form) {
    lines.push('📣 Реклама');
    add('Кампания', campaign);
    add('Группа объявлений', adset);
    add('Объявление', ad);
    add('Форма', form);
    lines.push('');
  }

  const purchasePlan = metaValue(meta, 'purchasePlan');
  const installments = metaValue(meta, 'installments');
  if (purchasePlan || installments) {
    lines.push('🏡 Запрос клиента');
    add('Планирует покупку', purchasePlan);
    add('Нужна рассрочка', installments);
    lines.push('');
  }

  lines.push('🔖 Meta Lead ID: ' + (metaValue(meta, 'leadId') || '—'));
  lines.push('🕒 Дата: ' + (createdAt || new Date().toISOString()));
  return lines.join('\n').trim();
};

// Google Sheets bridge for Meta instant-form leads.
// Deliberately does not create a lead_requests record. It sends through the
// client's interactive bot to its owner and the super-admin.
router.post('/google-sheets', async (req, res) => {
  const clientId = text(req.body?.clientId, 80);
  const configuredClientId = text(process.env.BOT_CLIENT_ID || process.env.CLIENT_ID, 80);
  const name = text(req.body?.name, 200);
  const phoneNumber = text(req.body?.phoneNumber, 100).replace(/^p:/i, '').trim();
  const comment = text(req.body?.comment, 3500);
  const createdAt = text(req.body?.createdAt, 100) || new Date().toISOString();
  const suppliedMeta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
  // Supports the already installed Apps Script, which sends Meta attributes
  // as labelled lines in comment, and future structured meta payloads.
  const meta = { ...readMetaFromComment(comment), ...suppliedMeta };

  if (!clientId) {
    return res.status(400).json({ ok: false, error: 'clientId is required' });
  }
  if (configuredClientId && clientId !== configuredClientId) {
    return res.status(403).json({ ok: false, error: 'clientId does not match this backend' });
  }
  if (!name) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  if (!phoneNumber) {
    return res.status(400).json({ ok: false, error: 'phoneNumber is required' });
  }

  try {
    const result = await notifyLeadToProjectTelegram({
      source: 'meta_google_sheets',
      name,
      phoneNumber,
      comment,
      notificationText: buildMetaLeadTelegramMessage({ name, phoneNumber, createdAt, meta }),
      language: 'uk',
      createdAt,
      preferredContactMethod: 'phone'
    });

    if (result?.skipped) {
      return res.status(503).json({ ok: false, error: 'telegram_notifier_not_configured' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.warn('[meta-leads] Google Sheets notification failed:', error?.message || error);
    return res.status(502).json({ ok: false, error: 'telegram_send_failed' });
  }
});

export default router;
