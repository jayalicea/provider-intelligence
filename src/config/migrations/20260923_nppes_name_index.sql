-- Name lookups against the full NPPES enumeration load (9.7M rows).
-- Backed by tools/cannabis-nppes-match.js: cannabis_certifications rows with
-- npi IS NULL are cross-referenced to NPPES by last+first name in-state,
-- with the same audit gate as tools/cannabis-npi-enrich.js.
CREATE INDEX IF NOT EXISTS idx_nppes_providers_name
  ON nppes_providers (last_name, first_name);
