-- License-less sources (first: Alabama AMCC) publish no license number, so
-- there is no key to match providers on. cannabis_certifications.license_number
-- becomes nullable; Postgres treats NULLs as distinct under
-- UNIQUE(state, license_number), so license-less sources use
-- replace-per-source semantics (their ingest DELETEs the source's rows and
-- INSERTs the current list) instead of the keyed upsert FL/WV use.

ALTER TABLE cannabis_certifications
  ALTER COLUMN license_number DROP NOT NULL;
