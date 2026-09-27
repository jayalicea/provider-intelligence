-- requires-table: clia_labs
-- QCOR enrichment columns written by tools/clia-director-qcor.js (lab
-- director, director NPI match, certificate expiration, facility type,
-- accrediting orgs). These were first added by hand; IF NOT EXISTS makes
-- this a no-op on databases that already have them.
ALTER TABLE clia_labs ADD COLUMN IF NOT EXISTS director_name TEXT;
ALTER TABLE clia_labs ADD COLUMN IF NOT EXISTS director_npi TEXT;
ALTER TABLE clia_labs ADD COLUMN IF NOT EXISTS certificate_expiration_dt DATE;
ALTER TABLE clia_labs ADD COLUMN IF NOT EXISTS qcor_facility_type TEXT;
ALTER TABLE clia_labs ADD COLUMN IF NOT EXISTS qcor_accrediting_orgs TEXT;

CREATE INDEX IF NOT EXISTS idx_clia_labs_cert_expiration
  ON clia_labs(certificate_expiration_dt)
  WHERE currently_registered AND certificate_expiration_dt IS NOT NULL;
