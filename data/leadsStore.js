// data/leadsStore.js
// Простое in-memory хранилище лидов (временно, до БД/CRM). Не для продакшена.

const leads = new Map();

/**
 * Сохранить лид (перезапишет по id)
 * @param {object} lead
 */
export function saveLead(lead) {
  if (!lead || !lead.id) throw new Error('LEAD_ID_REQUIRED');
  leads.set(lead.id, lead);
  return lead;
}

/**
 * Получить лид по id
 */
export function getLead(id) {
  return leads.get(id) || null;
}

/**
 * Получить список лидов (ограничение по количеству)
 */
export function listLeads(limit = 100) {
  return Array.from(leads.values())
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    .slice(0, Number(limit) || 100);
}

/**
 * Простая политика хранения: очистка старше N дней (ручной вызов)
 */
export function purgeOlderThan(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  leads.forEach((lead, id) => {
    const ts = Date.parse(lead.created_at);
    if (!Number.isNaN(ts) && ts < cutoff) {
      leads.delete(id);
      removed += 1;
    }
  });
  return removed;
}

export default { saveLead, getLead, listLeads, purgeOlderThan };


