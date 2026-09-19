-- Verified license status from state licensing-board open data (Socrata).
-- Phase 1 sources (docs/research/license-source-survey.md): Texas Medical
-- Board (data.texas.gov tm3v-pfq9) and Colorado DORA (data.colorado.gov
-- 7s5z-vewr). Unlike provider_licenses (self-reported NPPES baseline), rows
-- here are board-published status/expiration/discipline values.

CREATE TABLE IF NOT EXISTS license_status (
  id                   BIGSERIAL    PRIMARY KEY,
  license_number       TEXT         NOT NULL,
  issuing_state        CHAR(2)      NOT NULL,
  license_type         TEXT,
  status               TEXT,
  status_date          DATE,
  expiration_date      DATE,
  disciplinary_status  TEXT,
  raw_name             TEXT,
  source               TEXT         NOT NULL,
  as_of                DATE         NOT NULL DEFAULT CURRENT_DATE
);

-- One board row per (state, license number, license type); license_type is
-- nullable, so the unique key needs the COALESCE expression index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_status_key
  ON license_status (issuing_state, license_number, COALESCE(license_type, ''));

CREATE INDEX IF NOT EXISTS idx_license_status_number
  ON license_status (license_number);
