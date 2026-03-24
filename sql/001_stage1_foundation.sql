-- Stage 1 Foundation (safe / backward-compatible)
-- Purpose:
-- 1) Remove legacy support contour from runtime code (done in codebase)
-- 2) Add users table
-- 3) Evolve properties toward flexible geo/features/media model
-- 4) Keep old properties columns intact for compatibility (no destructive drop here)

BEGIN;

-- =========================================================
-- 1) USERS
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  tg_user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS users_client_tg_uidx
  ON users (client_id, tg_user_id);

CREATE INDEX IF NOT EXISTS users_client_last_seen_idx
  ON users (client_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS users_client_username_idx
  ON users (client_id, username);

-- =========================================================
-- 2) PROPERTIES (non-destructive extension)
-- =========================================================
ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_period TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS geo JSONB;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS features JSONB;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS media JSONB;

-- Canonical operation values for forward compatibility:
-- buy -> sale, keep rent as is.
UPDATE properties
SET operation = 'sale'
WHERE LOWER(TRIM(COALESCE(operation, ''))) = 'buy';

-- Apply a guarded check: only enforce for non-null values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'properties_operation_ck'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_operation_ck
      CHECK (operation IS NULL OR operation IN ('sale', 'rent'));
  END IF;
END $$;

-- Backfill geo from legacy location_* columns.
UPDATE properties
SET geo = jsonb_strip_nulls(
  jsonb_build_object(
    'country', location_country,
    'city', location_city,
    'district', location_district,
    'neighborhood', location_neighborhood,
    'address', location_address
  )
)
WHERE geo IS NULL;

-- Backfill features from legacy typed columns.
UPDATE properties
SET features = jsonb_strip_nulls(
  jsonb_build_object(
    'furnished', furnished,
    'buildingYear', building_year,
    'buildingFloors', building_floors,
    'buildingInfrastructure', building_infrastructure,
    'rooms', specs_rooms,
    'bathrooms', specs_bathrooms,
    'areaM2', specs_area_m2,
    'floor', specs_floor,
    'balcony', specs_balcony,
    'terrace', specs_terrace,
    'pricePerM2', price_per_m2
  )
)
WHERE features IS NULL;

-- Backfill media from images.
UPDATE properties
SET media = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'type', 'image',
        'url', img
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements_text(COALESCE(images::jsonb, '[]'::jsonb)) AS img
)
WHERE media IS NULL;

-- Useful indexes for scale and filtering.
CREATE INDEX IF NOT EXISTS properties_client_active_idx
  ON properties (client_id, is_active);

CREATE INDEX IF NOT EXISTS properties_client_operation_idx
  ON properties (client_id, operation);

CREATE INDEX IF NOT EXISTS properties_price_amount_idx
  ON properties (price_amount);

CREATE INDEX IF NOT EXISTS properties_geo_gin_idx
  ON properties USING GIN (geo);

CREATE INDEX IF NOT EXISTS properties_features_gin_idx
  ON properties USING GIN (features);

CREATE INDEX IF NOT EXISTS properties_media_gin_idx
  ON properties USING GIN (media);

-- Ensure unique pair for external sync (if absent).
CREATE UNIQUE INDEX IF NOT EXISTS properties_client_external_uidx
  ON properties (client_id, external_id);

COMMIT;
