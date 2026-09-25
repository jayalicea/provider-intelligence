-- CLIA laboratories: CMS Provider of Services (POS) Clinical Laboratories
-- file, published quarterly on data.cms.gov (bulk CSV + data-api). The CLIA
-- number (PRVDR_NUM, 10 chars, e.g. 01D0026356) is the laboratory's
-- canonical identifier and the primary key - the laboratory analog of the
-- physician NPI. History columns mirror cannabis_certifications: quarterly
-- re-ingests UPDATE survivors and retire CLIA numbers absent from the new
-- vintage rather than deleting them.
CREATE TABLE IF NOT EXISTS clia_labs (
    clia_number              TEXT PRIMARY KEY,
    lab_name                 TEXT NOT NULL,
    additional_lab_name      TEXT,
    address                  TEXT,
    city                     TEXT,
    state                    VARCHAR(2),
    zip                      VARCHAR(10),
    phone                    VARCHAR(20),
    fax                      VARCHAR(20),
    certificate_type_cd      VARCHAR(2),
    certificate_effective_dt DATE,
    certification_dt         DATE,
    compliance_status_cd     VARCHAR(2),
    termination_cd           VARCHAR(2),
    termination_dt           DATE,
    clia_termination_cd      VARCHAR(2),
    lab_classification_cd    VARCHAR(2),
    lab_classification_cds   TEXT[],
    medicare_number          TEXT,
    original_participation_dt DATE,
    ownership_type_cd        VARCHAR(2),
    accreditation            JSONB,
    npi                      TEXT,
    first_seen_at            DATE,
    last_confirmed_at        DATE,
    currently_registered     BOOLEAN NOT NULL DEFAULT TRUE,
    data_source              TEXT,
    sync_timestamp           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clia_labs_state ON clia_labs(state);
CREATE INDEX IF NOT EXISTS idx_clia_labs_name ON clia_labs(lab_name);
CREATE INDEX IF NOT EXISTS idx_clia_labs_city ON clia_labs(city);
CREATE INDEX IF NOT EXISTS idx_clia_labs_npi ON clia_labs(npi) WHERE npi IS NOT NULL;
