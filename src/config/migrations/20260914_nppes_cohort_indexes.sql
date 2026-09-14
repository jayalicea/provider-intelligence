-- Composite index for the national cohort scan on nppes_providers
-- (GET /api/v1/intelligence/cohort?source=national). The v2 ingest migration
-- (20260913_create_nppes_providers.sql) already created single-column indexes
-- on practice_state and primary_taxonomy_code; this composite supports the
-- state + taxonomy-prefix filter pair.

CREATE INDEX IF NOT EXISTS idx_nppes_providers_state_taxonomy
  ON nppes_providers (practice_state, primary_taxonomy_code);
