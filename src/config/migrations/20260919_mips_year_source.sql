-- Distinguish true per-year MIPS rows (bulk-loaded from archived
-- per-performance-year "Clinician Public Reporting: Overall MIPS
-- Performance" CSV vintages, see docs/research/mips-yearly-sources.md)
-- from rows cached on demand off the single rolling CMS vintage, whose
-- performance_year is the request label, not a measurement year.
-- Loaded by tools/mips-yearly-ingest.js ('archive'); the request-path
-- cache in cmsDataService keeps the default 'rolling'.

ALTER TABLE mips_performance_scores
  ADD COLUMN IF NOT EXISTS year_source TEXT NOT NULL DEFAULT 'rolling';

CREATE INDEX IF NOT EXISTS idx_mips_year_source
  ON mips_performance_scores (year_source);
