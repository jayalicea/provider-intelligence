const db = require('../config/database');
const { logger } = require('../utils/logger');

// Directory + detail reads over clia_labs. The CLIA number is the
// canonical lab identifier, mirroring the NPI on the provider side.
// CLIA certificate type codes, verified against CMS certificate
// definitions (1=Compliance, 2=Waiver, 3=Accreditation, 4=PPMP,
// 9=Registration). Unknown codes fall back to 'Type N'.
const CERT_TYPE_LABELS = {
  1: 'Certificate of Compliance',
  2: 'Certificate of Waiver',
  3: 'Certificate of Accreditation',
  4: 'PPMP (physician-performed microscopy)',
  9: 'Certificate of Registration'
};

class CliaService {
  /**
   * Search registered labs by name substring and/or state.
   * name matches lab_name (case-insensitive); state is a two-letter code.
   */
  async searchLabs({ name, state, city, limit = 50, offset = 0 } = {}) {
    const conditions = ['currently_registered = true'];
    const params = [];
    if (name) {
      params.push(`%${name}%`);
      conditions.push(`lab_name ILIKE $${params.length}`);
    }
    if (state) {
      params.push(state.toUpperCase());
      conditions.push(`state = $${params.length}`);
    }
    if (city) {
      params.push(`%${city}%`);
      conditions.push(`city ILIKE $${params.length}`);
    }
    params.push(Math.min(parseInt(limit, 10) || 50, 100), parseInt(offset, 10) || 0);

    const result = await db.query(
      `SELECT clia_number, lab_name, additional_lab_name, address, city, state, zip,
              phone, certificate_type_cd, certificate_effective_dt, lab_classification_cds,
              accreditation, last_confirmed_at
         FROM clia_labs
        WHERE ${conditions.join(' AND ')}
        ORDER BY lab_name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = await db.query(
      `SELECT COUNT(*)::int AS n FROM clia_labs WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2)
    );

    return { rows: result.rows.map(r => this.normalizeRow(r)), total: total.rows[0].n };
  }

  /**
   * One lab by CLIA number; null when unknown.
   */
  async getLabByCliaNumber(cliaNumber) {
    const result = await db.query(
      'SELECT * FROM clia_labs WHERE clia_number = $1',
      [cliaNumber]
    );
    if (result.rows.length === 0) return null;
    return this.normalizeRow(result.rows[0]);
  }

  /**
   * Delisting alerts: labs that disappeared from the latest CLIA vintage,
   * and certified physicians who disappeared from their state registry
   * edition. Presence on a government list is the compliance signal; losing
   * it is the alert.
   */
  async getDelistedAlerts() {
    const labs = await db.query(
      `SELECT clia_number, lab_name, state, city, last_confirmed_at
         FROM clia_labs
        WHERE currently_registered = false
        ORDER BY last_confirmed_at DESC
        LIMIT 100`
    );
    const certifiers = await db.query(
      `SELECT state, practitioner_last_name, practitioner_first_name,
              source_name, program_name, last_confirmed_at
         FROM cannabis_certifications
        WHERE currently_listed = false
        ORDER BY last_confirmed_at DESC
        LIMIT 100`
    );
    return {
      labs: labs.rows.map(r => ({
        cliaNumber: r.clia_number,
        labName: r.lab_name,
        state: r.state,
        city: r.city,
        lastConfirmedAt: r.last_confirmed_at
      })),
      certifiers: certifiers.rows.map(r => ({
        state: r.state,
        lastName: r.practitioner_last_name,
        firstName: r.practitioner_first_name,
        sourceName: r.source_name,
        programName: r.program_name,
        lastConfirmedAt: r.last_confirmed_at
      }))
    };
  }

  /**
   * Loose CLIA format check: 10 chars, 2-digit state prefix, alphanumeric.
   * (The third character is conventionally a facility-type letter, e.g. D
   * for independent labs, but the registry also issues all-digit numbers.)
   */
  validateCliaFormat(value) {
    return /^[0-9]{2}[A-Z0-9]{8}$/.test(String(value || '').toUpperCase());
  }

  normalizeRow(r) {
    return {
      cliaNumber: r.clia_number,
      labName: r.lab_name,
      additionalLabName: r.additional_lab_name,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      phone: r.phone,
      fax: r.fax,
      certificateTypeCd: r.certificate_type_cd,
      certificateTypeLabel: CERT_TYPE_LABELS[r.certificate_type_cd] || `Type ${r.certificate_type_cd}`,
      certificateEffectiveDate: r.certificate_effective_dt,
      certificationDate: r.certification_dt,
      complianceStatusCd: r.compliance_status_cd,
      terminationCd: r.termination_cd,
      terminationDate: r.termination_dt,
      labClassificationCd: r.lab_classification_cd,
      labClassificationCds: r.lab_classification_cds || [],
      medicareNumber: r.medicare_number,
      ownershipTypeCd: r.ownership_type_cd,
      accreditation: r.accreditation || {},
      npi: r.npi,
      firstSeenAt: r.first_seen_at,
      lastConfirmedAt: r.last_confirmed_at,
      currentlyRegistered: r.currently_registered,
      dataSource: r.data_source,
      syncTimestamp: r.sync_timestamp
    };
  }
}

module.exports = CliaService;
