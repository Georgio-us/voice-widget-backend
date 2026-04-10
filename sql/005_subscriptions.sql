-- Stage 5: Subscriptions and Activation Keys
-- Purpose:
-- 1) Owner subscription lifecycle (trial/month/year/lifetime)
-- 2) Activation key issuance and redemption history
-- 3) Idempotent setup for new tenant databases

BEGIN;

-- 0) Technical prerequisites
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_plan') THEN
    CREATE TYPE subscription_plan AS ENUM ('trial_7', 'month_30', 'year_365', 'lifetime');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'revoked');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activation_source') THEN
    CREATE TYPE activation_source AS ENUM ('manual', 'key');
  END IF;
END$$;

-- 2) Owner subscriptions
CREATE TABLE IF NOT EXISTS owner_subscriptions (
  id                  BIGSERIAL PRIMARY KEY,
  owner_tg_id         BIGINT NOT NULL,
  plan                subscription_plan NOT NULL,
  status              subscription_status NOT NULL DEFAULT 'active',
  starts_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at             TIMESTAMPTZ NULL, -- NULL for lifetime
  activation_source   activation_source NOT NULL DEFAULT 'manual',
  activated_by_tg_id  BIGINT NULL,      -- usually super admin
  note                TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active subscription at a time per owner
CREATE UNIQUE INDEX IF NOT EXISTS ux_owner_subscriptions_active
  ON owner_subscriptions (owner_tg_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_owner_subscriptions_owner_tg_id
  ON owner_subscriptions (owner_tg_id);

CREATE INDEX IF NOT EXISTS ix_owner_subscriptions_ends_at
  ON owner_subscriptions (ends_at);

-- 3) Activation keys
CREATE TABLE IF NOT EXISTS license_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash            TEXT NOT NULL UNIQUE, -- hash(key + pepper) on backend
  key_last4           VARCHAR(4) NOT NULL,  -- audit/debug helper
  plan                subscription_plan NOT NULL,
  duration_days       INTEGER NOT NULL CHECK (duration_days >= 0), -- 0 for lifetime
  max_redemptions     INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
  redemptions_count   INTEGER NOT NULL DEFAULT 0 CHECK (redemptions_count >= 0),
  valid_from          TIMESTAMPTZ NULL,
  valid_until         TIMESTAMPTZ NULL,
  issued_to_tg_id     BIGINT NULL,          -- optional owner lock
  issued_by_tg_id     BIGINT NULL,          -- who issued
  is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_license_keys_issued_to_tg_id
  ON license_keys (issued_to_tg_id);

CREATE INDEX IF NOT EXISTS ix_license_keys_valid_until
  ON license_keys (valid_until);

-- 4) Redemption history
CREATE TABLE IF NOT EXISTS license_redemptions (
  id                  BIGSERIAL PRIMARY KEY,
  license_key_id      UUID NOT NULL REFERENCES license_keys(id) ON DELETE RESTRICT,
  redeemed_by_tg_id   BIGINT NOT NULL, -- owner_tg_id who redeemed key
  redeemed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  subscription_id     BIGINT NULL REFERENCES owner_subscriptions(id) ON DELETE SET NULL,
  key_last4           VARCHAR(4) NOT NULL,
  request_meta        JSONB NULL
);

CREATE INDEX IF NOT EXISTS ix_license_redemptions_owner
  ON license_redemptions (redeemed_by_tg_id, redeemed_at DESC);

-- 5) updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_owner_subscriptions_updated_at ON owner_subscriptions;
CREATE TRIGGER trg_owner_subscriptions_updated_at
BEFORE UPDATE ON owner_subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_license_keys_updated_at ON license_keys;
CREATE TRIGGER trg_license_keys_updated_at
BEFORE UPDATE ON license_keys
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

