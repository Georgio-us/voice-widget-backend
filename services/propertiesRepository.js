// services/propertiesRepository.js
import { pool } from './db.js';

const DEFAULT_CLIENT_ID = 'demo';

// Получить все квартиры для клиента (пока используем только demo)
export async function getAllProperties(clientId = DEFAULT_CLIENT_ID) {
  const { rows } = await pool.query(
    `
    SELECT raw
    FROM properties
    WHERE client_id = $1 AND is_active = true
    ORDER BY id
    `,
    [clientId]
  );

  // raw у нас jsonb — pg сам парсит его в JS-объект
  return rows.map((row) => row.raw);
}

// Получить одну квартиру по external_id (например "A001")
export async function getPropertyByExternalId(externalId, clientId = DEFAULT_CLIENT_ID) {
  const { rows } = await pool.query(
    `
    SELECT raw
    FROM properties
    WHERE client_id = $1
      AND (
        external_id = $2
        OR CAST(id AS TEXT) = $2
      )
    LIMIT 1
    `,
    [clientId, externalId]
  );

  if (!rows.length) return null;
  return rows[0].raw;
}