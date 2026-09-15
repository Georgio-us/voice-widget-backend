BEGIN;

CREATE TABLE IF NOT EXISTS estate_crm_connections (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  crm_connection_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  crm_api_base_url TEXT NOT NULL,
  encrypted_shared_credential TEXT NOT NULL,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estate_crm_selections (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL,
  crm_connection_id TEXT NOT NULL,
  crm_external_selection_id UUID NOT NULL,
  crm_context_id UUID NOT NULL,
  opaque_token TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, crm_external_selection_id),
  UNIQUE (client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS estate_crm_selection_items (
  selection_id UUID NOT NULL REFERENCES estate_crm_selections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (selection_id, external_id)
);

CREATE TABLE IF NOT EXISTS estate_crm_event_outbox (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL,
  crm_connection_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estate_crm_selections_client_status_idx
  ON estate_crm_selections (client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS estate_crm_outbox_pending_idx
  ON estate_crm_event_outbox (status, next_attempt_at);

COMMIT;
