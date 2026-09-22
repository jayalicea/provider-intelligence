-- Medical-cannabis certifying practitioners from state program registries.
-- First source: Florida OMMU "Qualified Physician List" (weekly PDF parse).
-- Unlike provider_licenses (self-reported NPPES baseline), these are
-- practitioners a state program has qualified to recommend cannabis. Names
-- are stored as separate first/last columns because the FL source publishes
-- them as separate columns (the survey CSV's single practitioner_name is
-- split here to match). The source labels those columns "Last Name"/"First
-- Name" but fills them first-then-last ("GREG WESTWOOD"); this table stores
-- the actual first/last. Matching to providers is license-number-keyed.

CREATE TABLE IF NOT EXISTS cannabis_certifications (
  id                       BIGSERIAL    PRIMARY KEY,
  state                    VARCHAR(2)   NOT NULL,
  source_name              TEXT         NOT NULL,
  source_url               TEXT,
  practitioner_first_name  TEXT,
  practitioner_last_name   TEXT,
  credential               TEXT,
  npi                      VARCHAR(10),
  license_number           TEXT         NOT NULL,
  certification_status     TEXT         NOT NULL,
  program_name             TEXT         NOT NULL,
  as_of                    DATE         NOT NULL,
  retrieval_method         TEXT         NOT NULL,
  provenance_note          TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (state, license_number)
);

CREATE INDEX IF NOT EXISTS idx_cannabis_certifications_license
  ON cannabis_certifications (license_number, state);
