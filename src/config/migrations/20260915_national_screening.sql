-- Materialized national screening table (overnight build).
-- One row per NPI in nppes_providers, with exclusion verdicts from both
-- registries and the latest cached MIPS score. Verdict semantics match the
-- intelligence service: an active exclusion row is EXCLUDED, a row whose
-- reinstatement is recorded is REINSTATED, and no record at all is CLEAR.
-- LEIE and state registries are stored independently (leie_* wins at read
-- time, exactly as the service resolves them).

CREATE TABLE IF NOT EXISTS national_screening (
  npi                   CHAR(10) PRIMARY KEY,
  entity_name           TEXT,
  entity_type           TEXT NOT NULL,
  practice_state        VARCHAR(40),
  practice_city         TEXT,
  primary_taxonomy_code VARCHAR(10),
  leie_verdict          TEXT NOT NULL,
  leie_detail           JSONB,
  state_verdict         TEXT NOT NULL,
  state_detail          JSONB,
  mips_available        BOOLEAN NOT NULL DEFAULT false,
  final_score           NUMERIC(5,2),
  computed_at           DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_national_screening_state ON national_screening (practice_state);
CREATE INDEX IF NOT EXISTS idx_national_screening_taxonomy ON national_screening (primary_taxonomy_code);
CREATE INDEX IF NOT EXISTS idx_national_screening_leie_verdict ON national_screening (leie_verdict);
CREATE INDEX IF NOT EXISTS idx_national_screening_state_verdict ON national_screening (state_verdict);
CREATE INDEX IF NOT EXISTS idx_national_screening_mips_available ON national_screening (mips_available);
