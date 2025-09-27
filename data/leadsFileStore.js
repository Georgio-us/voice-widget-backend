import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Базируемся на директории текущего модуля (…/Voice-Widget-Backend/data),
// а не на process.cwd(), чтобы избежать записи в неожиданный путь при ином CWD
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = __dirname;
const FILE_PATH = path.join(DATA_DIR, 'leads.json');
const RETENTION_DAYS = parseInt(process.env.LEADS_RETENTION_DAYS || '90', 10);

let loaded = false;
let items = []; // newest first
const byId = new Map();

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFromDisk() {
  if (loaded) return;
  ensureDir();
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, 'utf8');
      const data = JSON.parse(raw || '{}');
      if (Array.isArray(data.items)) {
        items = data.items.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
        byId.clear();
        for (const it of items) byId.set(it.id, it);
      }
    }
  } catch (e) {
    console.error('leadsFileStore load error:', e);
    items = [];
    byId.clear();
  }
  loaded = true;
}

function writeToDisk() {
  ensureDir();
  const data = { version: 1, items };
  const tmp = FILE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, FILE_PATH);
  } catch (e) {
    console.error('leadsFileStore write error:', e);
    throw e;
  }
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits; // compare by digits only
}

function normalizeContactValue(channel, value) {
  const ch = String(channel || '').toLowerCase();
  if (ch === 'email') return normalizeEmail(value);
  if (ch === 'phone' || ch === 'whatsapp') return normalizePhone(value);
  return String(value || '').trim().toLowerCase();
}

function isSameTimeWindow(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.date === b.date && a.from === b.from && a.to === b.to && a.timezone === b.timezone;
}

function msSinceIso(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (Date.now() - t);
}

export function saveLead(lead) {
  loadFromDisk();
  // newest first
  items.unshift(lead);
  byId.set(lead.id, lead);
  purgeOlderThan(RETENTION_DAYS); // opportunistic purge
  writeToDisk();
  return lead;
}

export function getLead(id) {
  loadFromDisk();
  return byId.get(id) || null;
}

export function listLeads(limit = 100) {
  loadFromDisk();
  return items.slice(0, Number(limit) || 100);
}

export function purgeOlderThan(days = RETENTION_DAYS) {
  loadFromDisk();
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const next = [];
  byId.clear();
  for (const it of items) {
    const ts = Date.parse(it.created_at);
    if (!Number.isNaN(ts) && ts < cutoff) continue;
    next.push(it);
    byId.set(it.id, it);
  }
  items = next;
  return true;
}

export function findDuplicate(lead, hours = 24) {
  loadFromDisk();
  const windowMs = hours * 60 * 60 * 1000;
  const normChannel = lead?.contact?.channel;
  const normValue = normalizeContactValue(normChannel, lead?.contact?.value);
  for (const it of items) {
    if (msSinceIso(it.created_at) > windowMs) break; // items sorted desc
    const ch = it?.contact?.channel;
    const val = normalizeContactValue(ch, it?.contact?.value);
    if (ch === normChannel && val === normValue) {
      // Если у входящего лида нет слота времени — дубликат по одному контакту
      if (!lead.time_window) return it;
      // Иначе сравниваем по контакт+слот
      if (isSameTimeWindow(it.time_window, lead.time_window)) return it;
    }
  }
  return null;
}

export function findSessionRepeat(lead, minutes = 10) {
  loadFromDisk();
  const windowMs = minutes * 60 * 1000;
  const sessionId = lead?.context?.sessionId;
  if (!sessionId) return null;
  const normChannel = lead?.contact?.channel;
  const normValue = normalizeContactValue(normChannel, lead?.contact?.value);
  for (const it of items) {
    if (msSinceIso(it.created_at) > windowMs) break;
    const sameSession = it?.context?.sessionId && it.context.sessionId === sessionId;
    if (!sameSession) continue;
    const ch = it?.contact?.channel;
    const val = normalizeContactValue(ch, it?.contact?.value);
    if (ch === normChannel && val === normValue && isSameTimeWindow(it.time_window, lead.time_window)) {
      return it; // already accepted in this session
    }
  }
  return null;
}

// periodic purge once a day
try {
  loadFromDisk();
  setInterval(() => {
    try {
      const changedBefore = items.length;
      purgeOlderThan(RETENTION_DAYS);
      if (items.length !== changedBefore) writeToDisk();
    } catch (e) { console.error('leadsFileStore purge error:', e); }
  }, 24 * 60 * 60 * 1000);
} catch {}

export default { saveLead, getLead, listLeads, purgeOlderThan, findDuplicate, findSessionRepeat };


