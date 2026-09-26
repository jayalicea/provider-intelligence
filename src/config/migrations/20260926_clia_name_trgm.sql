-- Accelerate ILIKE '%name%' lab searches over 681k rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_clia_labs_name_trgm
  ON clia_labs USING gin (lab_name gin_trgm_ops);
