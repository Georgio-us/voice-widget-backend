-- Per-tenant справочник ЖК (названия добавляют пользователи в рамках client_id).
-- Без сидов и без уведомлений; сортировка в приложении: created_at DESC (новые сверху).
-- name_normalized — для уникальности и поиска без дублей по регистру/лишним пробелам.

BEGIN;

CREATE TABLE IF NOT EXISTS client_residential_complexes (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  name_normalized TEXT GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_tg_user_id BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS client_residential_complexes_client_norm_uidx
  ON client_residential_complexes (client_id, name_normalized);

CREATE INDEX IF NOT EXISTS client_residential_complexes_client_created_idx
  ON client_residential_complexes (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_residential_complexes_client_id_idx
  ON client_residential_complexes (client_id);

COMMIT;
