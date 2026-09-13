-- ============================================
-- PROVIDER INTELLIGENCE PLATFORM DATABASE SCHEMA
-- ============================================

-- Provider Registry Table
CREATE TABLE providers (
    id SERIAL PRIMARY KEY,
    npi VARCHAR(10) UNIQUE NOT NULL,
    enumeration_type VARCHAR(20) NOT NULL CHECK (enumeration_type IN ('Individual', 'Organization')),

    -- Name Information
    name_first VARCHAR(255),
    name_middle VARCHAR(255),
    name_last VARCHAR(255),
    name_credential VARCHAR(100),
    name_prefix VARCHAR(50),
    name_suffix VARCHAR(50),
    name_full VARCHAR(500),

    -- Practice Information
    provider_type VARCHAR(255),
    primary_taxonomy_code VARCHAR(10),
    primary_taxonomy_description TEXT,
    taxonomy_grouping VARCHAR(255),
    taxonomy_classification VARCHAR(255),
    specialization VARCHAR(255),

    -- Address Information
    practice_address_line1 VARCHAR(255),
    practice_address_line2 VARCHAR(255),
    practice_city VARCHAR(100),
    practice_state CHAR(2),
    practice_zipcode VARCHAR(10),
    practice_phone VARCHAR(20),
    practice_fax VARCHAR(20),

    -- License Information
    license_number VARCHAR(100),
    license_issuing_state CHAR(2),
    medicare_provider_type VARCHAR(255),
    medicare_spc_code VARCHAR(20),

    -- Metadata
    created_date TIMESTAMP,
    last_updated_date TIMESTAMP,
    data_source VARCHAR(50) DEFAULT 'NPI_REGISTRY',
    sync_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Provider Addresses (One-to-Many)
CREATE TABLE provider_addresses (
    id SERIAL PRIMARY KEY,
    npi VARCHAR(10),
    address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('Practice', 'Mailing')),
    line1 VARCHAR(255),
    line2 VARCHAR(255),
    city VARCHAR(100),
    state CHAR(2),
    zipcode VARCHAR(10),
    phone VARCHAR(20),
    fax VARCHAR(20),
    country VARCHAR(3) DEFAULT 'USA',
    FOREIGN KEY (npi) REFERENCES providers(npi) ON DELETE CASCADE
);

-- Provider Taxonomies (One-to-Many)
CREATE TABLE provider_taxonomies (
    id SERIAL PRIMARY KEY,
    npi VARCHAR(10),
    taxonomy_code VARCHAR(10),
    description TEXT,
    grouping VARCHAR(255),
    classification VARCHAR(255),
    specialization VARCHAR(255),
    is_primary BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (npi) REFERENCES providers(npi) ON DELETE CASCADE
);

-- MIPS Performance Scores Table
CREATE TABLE mips_performance_scores (
    id SERIAL PRIMARY KEY,
    npi VARCHAR(10),
    performance_year INTEGER NOT NULL,

    -- Overall Score
    final_score DECIMAL(5,2),
    overall_category_score DECIMAL(5,2),

    -- Category Scores
    quality_score DECIMAL(5,2),
    improvement_activities_score DECIMAL(5,2),
    promoting_interoperability_score DECIMAL(5,2),
    cost_score DECIMAL(5,2),

    -- Performance Status
    performance_status VARCHAR(100),
    reporting_entity_type VARCHAR(100),
    group_size_category VARCHAR(100),

    -- Metadata
    data_source VARCHAR(50) DEFAULT 'CMS_OPEN_DATA',
    sync_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(npi, performance_year)
);

-- Quality Measures Table (Care Compare Data)
CREATE TABLE quality_measures (
    id SERIAL PRIMARY KEY,
    facility_id VARCHAR(20),  -- CCN for hospitals
    npi VARCHAR(10),          -- For providers
    measure_id VARCHAR(50),
    measure_name TEXT,
    score DECIMAL(10,4),
    denominator INTEGER,
    lower_estimate DECIMAL(10,4),
    higher_estimate DECIMAL(10,4),
    compared_to_national VARCHAR(100),
    reporting_period_start DATE,
    reporting_period_end DATE,
    data_source VARCHAR(50) DEFAULT 'CARE_COMPARE',
    sync_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API Request Log Table (for monitoring)
CREATE TABLE api_request_log (
    id SERIAL PRIMARY KEY,
    endpoint VARCHAR(255),
    method VARCHAR(10),
    parameters TEXT,  -- JSONB for storing query params
    response_status INTEGER,
    response_time_ms INTEGER,
    request_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT
);

-- Indexes for Performance
CREATE INDEX idx_providers_npi ON providers(npi);
CREATE INDEX idx_providers_name ON providers(name_last, name_first);
CREATE INDEX idx_providers_state ON providers(practice_state);
CREATE INDEX idx_providers_taxonomy ON providers(primary_taxonomy_code);
CREATE INDEX idx_mips_npi_year ON mips_performance_scores(npi, performance_year);
CREATE INDEX idx_mips_year_npi ON mips_performance_scores(performance_year, npi);
CREATE INDEX idx_quality_facility ON quality_measures(facility_id);
-- One row per facility/measure/family. Without this, two concurrent refreshes
-- of the same facility could each insert a full set of rows; it is also what
-- the ON CONFLICT upsert in cacheQualityMeasures targets.
CREATE UNIQUE INDEX idx_quality_facility_measure_source
    ON quality_measures(facility_id, measure_id, data_source);
