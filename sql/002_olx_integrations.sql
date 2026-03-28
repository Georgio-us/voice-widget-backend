-- Stage 2: OLX OAuth integration storage
-- Purpose:
-- 1) Store OAuth tokens per tenant/client and Telegram admin user
-- 2) Keep token metadata for expiry/diagnostics

BEGIN;

CREATE TABLE IF NOT EXISTS olx_integrations (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  tg_user_id BIGINT NOT NULL,
  olx_user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  raw_token_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS olx_integrations_client_tg_uidx
  ON olx_integrations (client_id, tg_user_id);

CREATE INDEX IF NOT EXISTS olx_integrations_client_idx
  ON olx_integrations (client_id);

CREATE INDEX IF NOT EXISTS olx_integrations_expires_at_idx
  ON olx_integrations (expires_at);

COMMIT;
