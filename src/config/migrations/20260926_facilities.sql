-- Facilities: CMS POS iQIES file covering Home Health Agencies, Ambulatory
-- Surgical Centers, and Hospice providers in one quarterly CSV. Identity
-- key is prvdr_num (CMS Certification Number - the facility analog of
-- NPI/CLIA). History columns mirror clia_labs; quarterly re-ingests
-- UPDATE survivors and retire CCNs absent from the new vintage.
CREATE TABLE IF NOT EXISTS facilities (
    ccn                      TEXT PRIMARY KEY,
    facility_name            TEXT NOT NULL,
    provider_type_id         TEXT,
    provider_subtype         TEXT,
    address                  TEXT,
    city                     TEXT,
    state                    VARCHAR(2),
    zip                      VARCHAR(10),
    phone                    VARCHAR(20),
    certification_dt         DATE,
    termination_dt           DATE,
    compliance_status        TEXT,
    accreditation_type_cd    TEXT,
    original_participation_dt DATE,
    first_seen_at            DATE,
    last_confirmed_at        DATE,
    currently_registered     BOOLEAN NOT NULL DEFAULT TRUE,
    npi                      TEXT,
    data_source              TEXT,
    sync_timestamp           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_facilities_state ON facilities(state);
CREATE INDEX IF NOT EXISTS idx_facilities_name ON facilities(facility_name);
CREATE INDEX IF NOT EXISTS idx_facilities_name_trgm ON facilities USING gin (facility_name gin_trgm_ops);
