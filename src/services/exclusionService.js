const db = require('../config/database');
const { logger } = require('../utils/logger');

// LEIE (oig_exclusions) resolution. Prefers a miss over a false clear:
// CLEAR is only returned when a definitive non-match was established, and a
// database error can never produce CLEAR.

const NPI_SENTINELS = new Set(['0000000000', '']);

const isValidNpi = v =>
  typeof v === 'string' && /^\d{10}$/.test(v) && !NPI_SENTINELS.has(v);

// Uppercase, trim, collapse whitespace, strip punctuation. The literal
// string 'NULL' appears in LEIE name columns and is treated as missing.
const normalize = v => {
  if (v === null || v === undefined) return '';
  const s = String(v).toUpperCase().trim();
  if (s === '' || s === 'NULL') return '';
  return s.replace(/[\s]+/g, ' ').replace(/[^\w\s]/g, '').trim();
};

const isReinstated = row => {
  const r = row.reindate;
  return r !== null && r !== undefined && String(r).trim() !== '' &&
    String(r).trim() !== '00000000';
};

// excldate/reindate are YYYYMMDD text; format as YYYY-MM-DD.
const formatLeieDate = v => {
  const s = String(v || '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s || null;
};

// pg returns the date-typed as_of column as a JS Date; serialize as YYYY-MM-DD.
const formatAsOf = v => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v === null || v === undefined ? null : String(v);
};

class ExclusionService {

  /**
   * Resolve one identity against oig_exclusions.
   * input: { npi, lastname, firstname, state, dob }
   * Returns { verdict, match, exclusion, reinstated, notes } where verdict is
   * EXCLUDED, CLEAR, or UNVERIFIED.
   */
  async resolveExclusion({ npi = null, lastname = null, firstname = null, state = null, dob = null } = {}) {
    const notes = [];
    const identity = { npi, lastname, firstname, state, dob };

    try {
      // 1. NPI exact match (only when a syntactically valid NPI is given).
      if (isValidNpi(npi)) {
        const result = await db.query(
          'SELECT * FROM oig_exclusions WHERE npi = $1',
          [npi]
        );
        const rows = result.rows || [];
        const active = rows.find(r => !isReinstated(r));
        const reinstatedRow = active ? null : rows[0] || null;

        if (active) {
          return {
            verdict: 'EXCLUDED',
            match: 'npi',
            exclusion: {
              type: active.excltype,
              date: formatLeieDate(active.excldate),
              source: active.source,
              asOf: formatAsOf(active.as_of)
            },
            reinstated: null,
            notes
          };
        }
        if (reinstatedRow) {
          notes.push('A prior exclusion record matched by NPI, but the ' +
            'individual has been reinstated; treated as clear as of the ' +
            'reinstatement date shown.');
          return {
            verdict: 'CLEAR',
            match: 'npi',
            exclusion: null,
            reinstated: {
              date: formatLeieDate(reinstatedRow.reindate),
              source: reinstatedRow.source,
              asOf: formatAsOf(reinstatedRow.as_of)
            },
            notes
          };
        }
        notes.push('No exclusion record found for this NPI in the LEIE.');
        return { verdict: 'CLEAR', match: 'npi', exclusion: null, reinstated: null, notes };
      }

      // 2. Name + state fallback (only when a usable identity was supplied).
      const nLast = normalize(lastname);
      const nFirst = normalize(firstname);
      const nState = normalize(state);
      if (nLast && nFirst && nState) {
        const result = await db.query(
          "SELECT * FROM oig_exclusions WHERE upper(regexp_replace(lastname, '[^A-Z0-9 ]', '', 'g')) = $1 AND upper(state) = $2",
          [nLast, nState]
        );
        const rows = (result.rows || []).filter(r =>
          normalize(r.lastname) === nLast &&
          normalize(r.firstname) === nFirst &&
          normalize(r.state) === nState
        );
        const active = rows.find(r => !isReinstated(r));
        const reinstatedRow = active ? null : rows[0] || null;

        if (active) {
          if (dob) {
            notes.push('Name and state matched an active LEIE record, but ' +
              'the LEIE carries no date of birth, so the DOB could not be ' +
              'confirmed against this record.');
          }
          return {
            verdict: 'EXCLUDED',
            match: 'name_state',
            exclusion: {
              type: active.excltype,
              date: formatLeieDate(active.excldate),
              source: active.source,
              asOf: formatAsOf(active.as_of)
            },
            reinstated: null,
            notes
          };
        }
        if (reinstatedRow) {
          notes.push('A prior exclusion record matched by name and state, ' +
            'but it has been reinstated; treated as clear as of the ' +
            'reinstatement date shown.');
          return {
            verdict: 'CLEAR',
            match: 'name_state',
            exclusion: null,
            reinstated: {
              date: formatLeieDate(reinstatedRow.reindate),
              source: reinstatedRow.source,
              asOf: formatAsOf(reinstatedRow.as_of)
            },
            notes
          };
        }
        notes.push('No exclusion record found for this name and state in the LEIE.');
        return { verdict: 'CLEAR', match: 'name_state', exclusion: null, reinstated: null, notes };
      }

      // 3. Neither a valid NPI nor a usable name/state identity: UNVERIFIED.
      if (npi && !isValidNpi(npi)) {
        notes.push(`NPI "${npi}" is not a usable 10-digit NPI.`);
      }
      notes.push('No valid NPI and no usable lastname, firstname, and state ' +
        'were supplied, so no definitive check could be performed.');
      return { verdict: 'UNVERIFIED', match: null, exclusion: null, reinstated: null, notes };
    } catch (error) {
      logger.error('Error resolving exclusion:', error);
      notes.push('The exclusion database query failed; status could not be ' +
        'verified. A miss is never assumed when the check cannot complete.');
      return { verdict: 'UNVERIFIED', match: null, exclusion: null, reinstated: null, notes };
    }
  }
}

module.exports = ExclusionService;
