// services/residentialComplexesRepository.js
import { pool } from './db.js';

const REQUIRED_CLIENT_ID = String(process.env.CLIENT_ID || '').trim();

const resolveClientId = (clientId) => {
  const resolved = String(clientId || REQUIRED_CLIENT_ID).trim();
  if (!resolved) {
    throw new Error('CLIENT_ID_ENV_REQUIRED');
  }
  return resolved;
};

const normalizeNameExpr = (paramIndex) =>
  `lower(btrim(regexp_replace($${paramIndex}::text, E'\\\\s+', ' ', 'g')))`;

/**
 * Список ЖК клиента: новые сверху (created_at DESC).
 * Поиск по подстроке в name / name_normalized.
 */
export async function listResidentialComplexes(clientId, { q = '', limit = 50, lang = 'ru' } = {}) {
  const safeClientId = resolveClientId(clientId);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 5000);
  const needle = String(q || '').trim().slice(0, 120);

  const extractDisplayName = (row) => {
    if (row.nameTranslations) {
      try {
        const t = typeof row.nameTranslations === 'string' ? JSON.parse(row.nameTranslations) : row.nameTranslations;
        if (lang === 'ua' && t.ua) return t.ua;
        if (lang === 'ru' && t.ru) return t.ru;
      } catch (e) {}
    }
    return row.name;
  };

  const mapRow = (row) => ({
    ...row,
    displayName: extractDisplayName(row)
  });

  if (!needle) {
    const { rows } = await pool.query(
      `
      SELECT id, name, created_at AS "createdAt", name_translations AS "nameTranslations", name_normalized_translations AS "nameNormalizedTranslations"
      FROM client_residential_complexes
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [safeClientId, lim]
    );
    return rows.map(mapRow);
  }

  const esc = String(needle).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const pattern = `%${esc}%`;

  const { rows } = await pool.query(
    `
    SELECT id, name, created_at AS "createdAt", name_translations AS "nameTranslations", name_normalized_translations AS "nameNormalizedTranslations"
    FROM client_residential_complexes
    WHERE client_id = $1
      AND (
        name ILIKE $2 ESCAPE '\\' 
        OR name_translations->>'ru' ILIKE $2 ESCAPE '\\' 
        OR name_translations->>'ua' ILIKE $2 ESCAPE '\\'
      )
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [safeClientId, pattern, lim]
  );
  return rows.map(mapRow);
}

import { translateResidentialComplex } from './localizationService.js';
import { normalizeResidentialComplexName } from './residentialComplexMatcher.js';

export async function insertResidentialComplex(clientId, rawName, createdByTgUserId = null) {
  const safeClientId = resolveClientId(clientId);
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new Error('NAME_REQUIRED');
  }
  if (name.length > 200) {
    throw new Error('NAME_TOO_LONG');
  }

  const tgStr = createdByTgUserId != null && String(createdByTgUserId).trim()
    ? String(createdByTgUserId).trim()
    : '';
  const tgNum = /^\d{1,19}$/.test(tgStr) ? tgStr : null;
  
  const norm = normalizeResidentialComplexName(name);
  if (!norm) {
    throw new Error('NAME_REQUIRED');
  }

  // Pre-check by any alias
  const { rows: precheckRows } = await pool.query(
    `
    SELECT id, name, created_at AS "createdAt", name_translations AS "nameTranslations"
    FROM client_residential_complexes
    WHERE client_id = $1
      AND (
        name_normalized = $2 
        OR name_normalized_translations->>'ru' = $2 
        OR name_normalized_translations->>'ua' = $2
      )
    LIMIT 1
    `,
    [safeClientId, norm]
  );
  if (precheckRows.length > 0) {
    return { item: precheckRows[0], existed: true };
  }

  const translations = await translateResidentialComplex(name);
  let normTranslations = null;
  if (translations) {
    normTranslations = {
      ru: normalizeResidentialComplexName(translations.ru),
      ua: normalizeResidentialComplexName(translations.ua)
    };
  }

  const insert = await pool.query(
    `
    INSERT INTO client_residential_complexes (
      client_id, 
      name, 
      created_by_tg_user_id,
      name_translations,
      name_normalized_translations
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (client_id, name_normalized) DO NOTHING
    RETURNING id, name, created_at AS "createdAt", name_translations AS "nameTranslations"
    `,
    [
      safeClientId, 
      name, 
      tgNum, 
      translations ? JSON.stringify(translations) : null,
      normTranslations ? JSON.stringify(normTranslations) : null
    ]
  );

  if (insert.rows[0]) {
    return { item: insert.rows[0], existed: false };
  }

  const { rows } = await pool.query(
    `
    SELECT id, name, created_at AS "createdAt", name_translations AS "nameTranslations"
    FROM client_residential_complexes
    WHERE client_id = $1
      AND name_normalized = $2
    LIMIT 1
    `,
    [safeClientId, norm]
  );

  if (!rows.length) {
    throw new Error('INSERT_CONFLICT_LOOKUP_FAILED');
  }
  return { item: rows[0], existed: true };
}

export async function ensureResidentialComplexes(clientId, names, createdByTgUserId = null) {
  const safeClientId = resolveClientId(clientId);
  const uniqueInput = [...new Set(
    (Array.isArray(names) ? names : [])
      .map(n => String(n || '').trim().replace(/\s+/g, ' '))
      .filter(n => n.length >= 2 && n.length <= 200)
  )];
  if (!uniqueInput.length) return 0;
  
  const CONCURRENCY_LIMIT = 3;
  let insertedCount = 0;
  
  for (let i = 0; i < uniqueInput.length; i += CONCURRENCY_LIMIT) {
    const batch = uniqueInput.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(batch.map(async (name) => {
      try {
        const res = await insertResidentialComplex(safeClientId, name, createdByTgUserId);
        if (!res.existed) insertedCount++;
      } catch (err) {
        console.error(`[ensureResidentialComplexes] Error for ${name}:`, err.message);
      }
    }));
  }
  
  return insertedCount;
}

/**
 * Удаление ЖК из справочника клиента (только эта строка в БД).
 */
export async function deleteResidentialComplex(clientId, rawId) {
  const safeClientId = resolveClientId(clientId);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('INVALID_ID');
  }
  const { rowCount } = await pool.query(
    `
    DELETE FROM client_residential_complexes
    WHERE client_id = $1 AND id = $2
    `,
    [safeClientId, id]
  );
  return { deleted: Number(rowCount || 0) > 0 };
}
