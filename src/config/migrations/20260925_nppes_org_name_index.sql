-- NPPES organization lookup for the CLIA cross-reference: organization
-- names live in legal_business_name (entity_type_code '2'), which had no
-- index. One-time build; used by tools/clia-npi-match.js.
CREATE INDEX IF NOT EXISTS idx_nppes_org_upper_name
  ON nppes_providers (upper(legal_business_name))
  WHERE entity_type_code = '2';
