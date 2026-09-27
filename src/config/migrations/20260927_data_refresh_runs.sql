-- One row per scheduled refresh-job run, written by tools/refresh-run.js
-- (called from tools/run-tracked.ps1 around each scheduled script).
-- GET /health/data reads it to report stale or failing jobs.
CREATE TABLE IF NOT EXISTS data_refresh_runs (
  id          BIGSERIAL   PRIMARY KEY,
  job         TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status      TEXT        NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'success', 'failed')),
  exit_code   INTEGER,
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_refresh_runs_job_started
  ON data_refresh_runs (job, started_at DESC);
