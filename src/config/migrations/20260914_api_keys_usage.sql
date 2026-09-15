-- Package C: API keys and usage metering.
-- api_keys is provisioned ahead of the key-management UI (env-seeded keys are
-- loaded into memory at startup for now); api_usage is written per request
-- by the metering middleware.

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash  TEXT PRIMARY KEY,
  label     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_usage (
  id         BIGSERIAL PRIMARY KEY,
  key_label  TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  method     TEXT NOT NULL,
  status     INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_key_label ON api_usage (key_label, created_at);
