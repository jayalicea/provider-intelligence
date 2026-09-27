const db = require('../config/database');
const { nameOrder } = require('../utils/searchOrder');

// provider_type_id labels, inferred from facility-name sampling of the Q1
// 2026 iQIES file (see docs/research/pos-iqies-hha-asc-hospice.md). Codes
// 3/20/12/11/7/8/6/5/13 are high-confidence; 10 is mixed - left raw. Verify
// against the CMS iQIES layout document when convenient.
const PROVIDER_TYPE_LABELS = {
  3: 'Home Health Agency',
  20: 'Skilled Nursing Facility',
  12: 'Hospice',
  11: 'Ambulatory Surgical Center',
  7: 'Dialysis (ESRD) Facility',
  8: 'ICF/IID',
  6: 'Outpatient Rehabilitation',
  5: 'Portable X-ray Supplier',
  13: 'Organ Procurement Organization'
};

class FacilityService {
  async searchFacilities({ name, state, type, city, limit = 50, offset = 0 } = {}) {
    const conditions = ['currently_registered = true'];
    const params = [];
    if (name) { params.push(`%${name}%`); conditions.push(`facility_name ILIKE $${params.length}`); }
    if (state) { params.push(state.toUpperCase()); conditions.push(`state = $${params.length}`); }
    if (type) { params.push(String(type)); conditions.push(`provider_type_id = $${params.length}`); }
    if (city) { params.push(`%${city}%`); conditions.push(`city ILIKE $${params.length}`); }
    params.push(Math.min(parseInt(limit, 10) || 50, 100), parseInt(offset, 10) || 0);

    const [result, total] = await Promise.all([
      db.query(
        `SELECT ccn, facility_name, provider_type_id, city, state, certification_dt, last_confirmed_at
           FROM facilities
          WHERE ${conditions.join(' AND ')}
          ORDER BY ${nameOrder(name, 'facility_name')}, ccn
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      db.query(
        `SELECT COUNT(*)::int AS n FROM facilities WHERE ${conditions.join(' AND ')}`,
        params.slice(0, -2)
      )
    ]);

    return { rows: result.rows.map(r => this.normalizeRow(r)), total: total.rows[0].n };
  }

  async getFacilityByCcn(ccn) {
    const result = await db.query('SELECT * FROM facilities WHERE ccn = $1', [ccn]);
    if (result.rows.length === 0) return null;
    return this.normalizeRow(result.rows[0]);
  }

  validateCcnFormat(value) {
    // CMS Certification Number: 6 characters, 2-digit state prefix; some
    // non-hospital facilities carry a short alphanumeric suffix.
    return /^[0-9]{6}[A-Z0-9]{0,3}$/i.test(String(value || '').trim());
  }

  normalizeRow(r) {
    return {
      ccn: r.ccn,
      facilityName: r.facility_name,
      providerTypeId: r.provider_type_id,
      providerTypeLabel: PROVIDER_TYPE_LABELS[r.provider_type_id] || `Type ${r.provider_type_id}`,
      providerSubtype: r.provider_subtype,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      phone: r.phone,
      certificationDate: r.certification_dt,
      terminationDate: r.termination_dt,
      complianceStatus: r.compliance_status,
      accreditationTypeCd: r.accreditation_type_cd,
      originalParticipationDate: r.original_participation_dt,
      npi: r.npi,
      firstSeenAt: r.first_seen_at,
      lastConfirmedAt: r.last_confirmed_at,
      currentlyRegistered: r.currently_registered,
      dataSource: r.data_source,
      syncTimestamp: r.sync_timestamp
    };
  }
}

module.exports = FacilityService;
