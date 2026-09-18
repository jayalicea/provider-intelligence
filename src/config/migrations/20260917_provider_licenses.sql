-- Per-provider license baseline from the NPI Registry (NPPES).
-- The providers table carries only the primary license (license_number,
-- license_issuing_state); this table stores every license the provider
-- self-reported to NPPES, with the embedded taxonomy details. These are
-- self-reported values, NOT verified board statuses.

CREATE TABLE IF NOT EXISTS provider_licenses (
  npi                      CHAR(10)     NOT NULL,
  license_number           TEXT         NOT NULL,
  issuing_state            VARCHAR(2)   NOT NULL,
  is_primary_taxonomy      BOOLEAN      NOT NULL DEFAULT false,
  taxonomy_code            VARCHAR(10),
  taxonomy_classification  TEXT,
  taxonomy_specialization  TEXT,
  source                   TEXT         NOT NULL DEFAULT 'NPI Registry',
  as_of                    DATE         NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (npi, license_number, issuing_state)
);

CREATE INDEX IF NOT EXISTS idx_provider_licenses_state
  ON provider_licenses (issuing_state);
