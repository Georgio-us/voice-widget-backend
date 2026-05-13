import mysql from 'mysql2/promise';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const DEFAULT_QUEUE_PATH = join(PROJECT_ROOT, 'data', 'mediaelx_leads_queue.jsonl');

const DEFAULT_PLACEHOLDER_EMAIL = 'no_mail_received@mail.com';
const DEFAULT_MOTIVE = 'VIA AI Widget';

let pool = null;

function getConfig() {
  const host = process.env.MEDIAELX_DB_HOST || '';
  const port = Number(process.env.MEDIAELX_DB_PORT || 3306);
  const user = process.env.MEDIAELX_DB_USER || '';
  const password = process.env.MEDIAELX_DB_PASSWORD || '';
  const database = process.env.MEDIAELX_DB_NAME || '';
  const charset = process.env.MEDIAELX_DB_CHARSET || 'utf8mb4';
  const enabled = String(process.env.MEDIAELX_ENABLED || '').toLowerCase() === 'true' || Boolean(host && user && database);
  const queuePath = process.env.MEDIAELX_QUEUE_PATH || DEFAULT_QUEUE_PATH;

  return { host, port, user, password, database, charset, enabled, queuePath };
}

function getPool() {
  const cfg = getConfig();
  if (!cfg.enabled) return null;
  if (pool) return pool;

  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: cfg.charset,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });
  return pool;
}

function normalizeLanguage(language) {
  const lang = String(language || 'ru').trim().toLowerCase();
  if (lang.startsWith('es')) return 'es';
  if (lang.startsWith('en')) return 'en';
  return 'ru';
}

function normalizePropertyId(propertyId) {
  const n = Number(propertyId);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.trunc(n);
}

async function resolveMediaelxPropertyPk(poolRef, propertyId) {
  const raw = String(propertyId ?? '').trim();
  if (!raw) return 0;

  // 1) Main mapping path: external/widget reference -> MediaElx PK (id_prop)
  const byReferenceSql = `
    SELECT id_prop
    FROM properties_properties
    WHERE referencia_prop = ?
       OR ref_xml_prop = ?
       OR id_xml_prop = ?
    LIMIT 1
  `;
  const [refRows] = await poolRef.query(byReferenceSql, [raw, raw, raw]);
  if (Array.isArray(refRows) && refRows.length > 0) {
    const mapped = Number(refRows[0]?.id_prop);
    if (Number.isFinite(mapped) && mapped > 0) return Math.trunc(mapped);
  }

  // 2) Fallback: if caller already passed internal PK
  const numeric = normalizePropertyId(raw);
  if (!numeric) return 0;
  const [idRows] = await poolRef.query(
    `
      SELECT id_prop
      FROM properties_properties
      WHERE id_prop = ?
      LIMIT 1
    `,
    [numeric]
  );
  if (Array.isArray(idRows) && idRows.length > 0) {
    return numeric;
  }

  return 0;
}

function normalizeEmail(email) {
  const value = String(email || '').trim();
  return value.length > 0 ? value : DEFAULT_PLACEHOLDER_EMAIL;
}

function stringifyInsights(insights) {
  if (!insights || typeof insights !== 'object') return '-';
  const parts = [];
  const push = (label, value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'string' && value.trim().length === 0) return;
    parts.push(`${label}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  };

  push('Операция', insights.operation);
  push('Тип', insights.type);
  push('Локация', insights.location);
  push('Локации', insights.locationsRaw);
  push('Комнаты', insights.rooms);
  push('Бюджет', insights.budget);
  push('Мин. бюджет', insights.budgetMin);
  push('Макс. бюджет', insights.budgetMax);
  push('Площадь', insights.area);
  push('Особенности', insights.features);
  push('Детали', insights.details);
  push('Предпочтения', insights.preferences);

  return parts.length ? parts.join(' | ') : '-';
}

function formatCommentBlock({
  formTypeLabel,
  preferredContactMethod,
  referenceId,
  aiSummary,
  userComment
}) {
  const method = String(preferredContactMethod || 'not_specified');
  const ref = String(referenceId || '-');
  const summary = String(aiSummary || '-');
  const comment = String(userComment || '-');

  return [
    '[ОТЧЕТ VIA AI]',
    '---------------------------',
    `ТИП ФОРМЫ: ${formTypeLabel}`,
    `СПОСОБ СВЯЗИ: ${method}`,
    `REF ОБЪЕКТА: ${ref}`,
    'РЕЗЮМЕ ИИ:',
    summary,
    '---------------------------',
    `СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: ${comment}`
  ].join('\n');
}

function mapFormType(source) {
  if (source === 'widget_full_form') return 'Header';
  if (source === 'widget_in_dialog') return 'Property';
  if (source === 'widget_manager_cta') return 'Manager CTA';
  if (source === 'widget_short_form') return 'Header';
  return 'Header';
}

function shouldQueueOnError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('connect') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('socket') ||
    msg.includes('too many connections') ||
    msg.includes('cannot enqueue') ||
    msg.includes('pool is closed')
  );
}

async function appendQueueRecord(queuePath, record) {
  await mkdir(dirname(queuePath), { recursive: true });
  await appendFile(queuePath, JSON.stringify(record) + '\n', 'utf8');
}

export async function mirrorLeadToMediaelx({
  source,
  name,
  phoneCountryCode,
  phoneNumber,
  email,
  preferredContactMethod,
  comment,
  language,
  propertyId,
  insights,
  aiSummary,
  sessionId
}) {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return { ok: false, skipped: true, reason: 'mediaelx_disabled' };
  }

  const idiomaCons = normalizeLanguage(language);
  const nombreCons = String(name || '').trim();
  const telefonoCons = `${String(phoneCountryCode || '').trim()} ${String(phoneNumber || '').trim()}`.trim() || null;
  const emailCons = normalizeEmail(email);
  const motivoCons = DEFAULT_MOTIVE;
  const formTypeLabel = mapFormType(source);
  const summaryText = String(aiSummary || '').trim() || stringifyInsights(insights);
  let inmuebleCons = normalizePropertyId(propertyId);
  const comentarioConsas = formatCommentBlock({
    formTypeLabel,
    preferredContactMethod,
    referenceId: propertyId,
    aiSummary: summaryText,
    userComment: comment
  });

  const dedupeSql = `
    SELECT id_cons
    FROM properties_enquiries
    WHERE LOWER(email_cons) = LOWER(?)
      AND inmueble_cons = ?
      AND fecha_cons >= (NOW() - INTERVAL 5 MINUTE)
    LIMIT 1
  `;

  const insertSql = `
    INSERT INTO properties_enquiries (
      inmueble_cons,
      idioma_cons,
      motivo_cons,
      nombre_cons,
      telefono_cons,
      email_cons,
      comentario_consas,
      read_cons
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `;

  const queueRecord = {
    ts: new Date().toISOString(),
    source: source || null,
    sessionId: sessionId || null,
    payload: {
      inmueble_cons: inmuebleCons,
      idioma_cons: idiomaCons,
      motivo_cons: motivoCons,
      nombre_cons: nombreCons,
      telefono_cons: telefonoCons,
      email_cons: emailCons,
      comentario_consas: comentarioConsas,
      read_cons: 0
    }
  };

  try {
    const p = getPool();
    if (!p) {
      return { ok: false, skipped: true, reason: 'mediaelx_pool_unavailable' };
    }

    inmuebleCons = await resolveMediaelxPropertyPk(p, propertyId);

    const [dupRows] = await p.query(dedupeSql, [emailCons, inmuebleCons]);
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      return { ok: true, deduped: true, inserted: false };
    }

    await p.query(insertSql, [
      inmuebleCons,
      idiomaCons,
      motivoCons,
      nombreCons,
      telefonoCons,
      emailCons,
      comentarioConsas
    ]);

    return { ok: true, inserted: true, deduped: false };
  } catch (err) {
    if (shouldQueueOnError(err)) {
      try {
        await appendQueueRecord(cfg.queuePath, queueRecord);
        return {
          ok: false,
          queued: true,
          reason: 'mediaelx_unavailable_queued',
          error: err?.message || 'unknown_error'
        };
      } catch (queueErr) {
        return {
          ok: false,
          queued: false,
          reason: 'mediaelx_unavailable_queue_failed',
          error: `${err?.message || 'unknown_error'}; queue_error=${queueErr?.message || 'unknown_error'}`
        };
      }
    }

    return {
      ok: false,
      queued: false,
      reason: 'mediaelx_insert_failed',
      error: err?.message || 'unknown_error'
    };
  }
}
