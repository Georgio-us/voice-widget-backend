import express from 'express';
import { createLead, validateLeadInput } from '../models/lead.js';
// Переключили стор на файловый (персистентный)
import { saveLead, getLead, listLeads, findDuplicate, findSessionRepeat } from '../data/leadsFileStore.js';
import { sendLeadToCRM } from '../services/crmStub.js';

const router = express.Router();

const maskContactValue = (contact) => {
  try {
    if (!contact || !contact.value) return '***';
    const v = String(contact.value);
    if (v.includes('@')) {
      const [name, domain] = v.split('@');
      const masked = name.length <= 2 ? '**' : name.slice(0, 2) + '*'.repeat(Math.max(1, name.length - 2));
      return `${masked}@${domain}`;
    }
    // phone/whatsapp: показать только последние 2 цифры
    const digits = v.replace(/\D/g, '');
    const tail = digits.slice(-2);
    return `***${tail ? tail : ''}`;
  } catch {
    return '***';
  }
};

// POST /api/leads — создать лид
router.post('/', (req, res) => {
  try {
    const input = req.body || {};
    const { valid, errors, normalized } = validateLeadInput(input);
    if (!valid) {
      // Преобразуем в формат поле → сообщение (минимально)
      const fieldErrors = [];
      for (const err of errors) {
        if (err === 'NAME_REQUIRED') fieldErrors.push({ field: 'name', message: 'Имя обязательно' });
        else if (err === 'CONTACT_REQUIRED') fieldErrors.push({ field: 'contact', message: 'Контакт обязателен' });
        else if (err === 'INVALID_EMAIL') fieldErrors.push({ field: 'contact', message: 'Некорректный email' });
        else if (err === 'INVALID_PHONE') fieldErrors.push({ field: 'contact', message: 'Некорректный номер телефона' });
        else if (err === 'UNSUPPORTED_CHANNEL') fieldErrors.push({ field: 'contact.channel', message: 'Неподдерживаемый канал' });
        else if (err === 'INVALID_DATE') fieldErrors.push({ field: 'time_window.date', message: 'Некорректная дата' });
        else if (err === 'INVALID_TIME_FROM') fieldErrors.push({ field: 'time_window.from', message: 'Некорректное время начала' });
        else if (err === 'INVALID_TIME_TO') fieldErrors.push({ field: 'time_window.to', message: 'Некорректное время конца' });
        else if (err === 'GDPR_CONSENT_REQUIRED') fieldErrors.push({ field: 'gdpr.consent', message: 'Требуется согласие GDPR' });
        else fieldErrors.push({ field: 'general', message: err });
      }
      return res.status(400).json({ ok: false, error: 'INVALID_INPUT', errors: fieldErrors });
    }

    // Повтор в рамках одной сессии за 10 минут — приоритетнее
    const repeat = findSessionRepeat(normalized, 10);
    if (repeat) {
      console.log(`📝 Lead already accepted in session: id=${repeat.id}`);
      return res.json({ ok: true, leadId: repeat.id, accepted: true });
    }

    // Дубликат за 24 часа (контакт + слот времени)
    const dupe = findDuplicate(normalized, 24);
    if (dupe) {
      console.log(`📝 Lead duplicate: id=${dupe.id}`);
      return res.json({ ok: true, leadId: dupe.id, duplicate: true });
    }

    const lead = createLead(input);
    saveLead(lead);

    // Лог без PII
    const c = lead.contact || {};
    console.log(`📝 Lead created: id=${lead.id}, channel=${c.channel || 'n/a'}, contact=${maskContactValue(c)}, lang=${lead.language}, status=${lead.status}`);

    // CRM handoff (stub), по флагу ENABLE_CRM
    try {
      const enabled = String(process.env.ENABLE_CRM || 'false').toLowerCase() === 'true';
      if (enabled) {
        sendLeadToCRM(lead, maskContactValue);
      }
    } catch (e) {
      console.warn('CRM handoff error (ignored):', e?.message || e);
    }

    return res.json({ ok: true, leadId: lead.id });
  } catch (e) {
    console.error('Lead create error:', e.errors || e.message || e);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

// GET /api/leads/:id — получить лид по id
// ===== Менеджерский список/экспорт (для внутренних нужд) =====
// GET /api/leads/list?limit=&status=&lang=
router.get('/list', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    const lang = req.query.lang ? String(req.query.lang).toLowerCase().slice(0,2) : null;

    let items = listLeads(isFinite(limit) ? limit : 100);

    if (status) items = items.filter(l => String(l.status || 'new').toLowerCase() === status);
    if (lang) items = items.filter(l => String(l.language || '').toLowerCase().startsWith(lang));

    const masked = items.map(l => ({
      id: l.id,
      created_at: l.created_at,
      name: l.name,
      channel: l?.contact?.channel || null,
      contact: l?.contact?.value ? maskContactValue(l.contact) : '***',
      time_window: l.time_window || null,
      language: l.language || null,
      status: l.status || 'new'
    }));

    return res.json({ items: masked });
  } catch (e) {
    console.error('Leads list (manager) error:', e.message || e);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

// GET /api/leads/export.csv — экспорт последних N лидов с фильтрами
router.get('/export.csv', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 1000;
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    const lang = req.query.lang ? String(req.query.lang).toLowerCase().slice(0,2) : null;

    let items = listLeads(isFinite(limit) ? limit : 1000);
    if (status) items = items.filter(l => String(l.status || 'new').toLowerCase() === status);
    if (lang) items = items.filter(l => String(l.language || '').toLowerCase().startsWith(lang));

    const rows = [
      ['id','created_at','name','channel','contact_masked','time_date','time_from','time_to','timezone','language','status']
    ];

    for (const l of items) {
      const tw = l.time_window || {};
      rows.push([
        l.id,
        l.created_at,
        l.name,
        l?.contact?.channel || '',
        l?.contact?.value ? maskContactValue(l.contact) : '***',
        tw.date || '',
        tw.from || '',
        tw.to || '',
        tw.timezone || '',
        l.language || '',
        l.status || 'new'
      ]);
    }

    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    }).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_export.csv"');
    return res.send(csv);
  } catch (e) {
    console.error('Leads export error:', e.message || e);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

// GET /api/leads/:id — получить лид по id
router.get('/:id', (req, res) => {
  try {
    const lead = getLead(req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    return res.json(lead);
  } catch (e) {
    console.error('Lead fetch error:', e.message || e);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});
// GET /api/leads?limit=n — список последних n лидов
router.get('/', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    const items = listLeads(isFinite(limit) ? limit : 100);
    return res.json({ items });
  } catch (e) {
    console.error('Leads list error:', e.message || e);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});
export default router;
