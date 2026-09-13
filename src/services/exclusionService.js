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

// oig_exclusions.dob stores dates as 8-digit YYYYMMDD text strings (verified
// by sampling the loaded snapshot: every populated value is 8 digits in
// 19xx/20xx, so MMDDYYYY is impossible). Roster DOB input arrives in mixed
// formats; strip non-digits and flip a value that looks like MMDDYYYY
// (month 01-12, year 19xx/20xx) to YYYYMMDD before comparing.
const digits = v => String(v === null || v === undefined ? '' : v).replace(/\D/g, '');

const canonicalizeDob = v => {
  const d = digits(v);
  if (!/^\d{8}$/.test(d)) return d || null;
  const month = parseInt(d.slice(0, 2), 10);
  const year = d.slice(4, 8);
  if (month >= 1 && month <= 12 &&
      (year.startsWith('19') || year.startsWith('20'))) {
    return d.slice(4, 8) + d.slice(0, 4); // MMDDYYYY -> YYYYMMDD
  }
  return d;
};

const rowDob = r => {
  const d = digits(r.dob);
  return d && d !== '00000000' ? d : null;
};

/**
 * Build the NPI-path verdict from the chosen oig_exclusions row, or from
 * null when the scan found no row for the NPI. Shared by resolveExclusion
 * and batched cohort scans so the NPI decision tree lives in one place.
 */
const verdictFromNpiRow = (row, notes = []) => {
  if (!row) {
    notes.push('No exclusion record found for this NPI in the LEIE.');
    return { verdict: 'CLEAR', match: 'npi', dobStatus: null, exclusion: null, reinstated: null, notes };
  }
  if (isReinstated(row)) {
    notes.push('A prior exclusion record matched by NPI, but the ' +
      'individual has been reinstated; treated as clear as of the ' +
      'reinstatement date shown.');
    return {
      verdict: 'CLEAR',
      match: 'npi',
      dobStatus: null,
      exclusion: null,
      reinstated: {
        date: formatLeieDate(row.reindate),
        source: row.source,
        asOf: formatAsOf(row.as_of)
      },
      notes
    };
  }
  return {
    verdict: 'EXCLUDED',
    match: 'npi',
    dobStatus: null, // NPI match is definitive; no DOB check applies
    exclusion: {
      type: row.excltype,
      date: formatLeieDate(row.excldate),
      source: row.source,
      asOf: formatAsOf(row.as_of)
    },
    reinstated: null,
    notes
  };
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
        return verdictFromNpiRow(active || rows[0] || null, notes);
      }

      // 2. Name + state fallback (only when a usable identity was supplied).
      const nLast = normalize(lastname);
      const nFirst = normalize(firstname);
      const nState = normalize(state);
      if (nLast && nFirst && nState) {
        const result = await db.query(
          "SELECT lastname, firstname, state, excltype, excldate, reindate, source, as_of, dob FROM oig_exclusions WHERE upper(regexp_replace(lastname, '[^A-Z0-9 ]', '', 'g')) = $1 AND upper(state) = $2 AND upper(regexp_replace(firstname, '[^A-Z0-9 ]', '', 'g')) = $3",
          [nLast, nState, nFirst]
        );
        const rows = (result.rows || []).filter(r =>
          normalize(r.lastname) === nLast &&
          normalize(r.firstname) === nFirst &&
          normalize(r.state) === nState
        );
        const actives = rows.filter(r => !isReinstated(r));
        const reinstatedRow = actives.length ? null : rows[0] || null;

        if (actives.length) {
          const inputDob = dob ? canonicalizeDob(dob) : null;
          const candidate = actives[0];

          if (inputDob) {
            const confirmed = actives.find(r => rowDob(r) === inputDob);
            if (confirmed) {
              notes.push('dob confirmed');
              return {
                verdict: 'EXCLUDED',
                match: 'name_state',
                dobStatus: 'confirmed',
                exclusion: {
                  type: confirmed.excltype,
                  date: formatLeieDate(confirmed.excldate),
                  source: confirmed.source,
                  asOf: formatAsOf(confirmed.as_of)
                },
                reinstated: null,
                notes
              };
            }
            if (actives.some(r => rowDob(r))) {
              // A candidate matched on name and state but the DOB disagrees.
              // The candidate stays reported (never silently ignored), but
              // prefer-miss-over-false-clear forbids overstating the match:
              // a DOB mismatch cannot be an EXCLUDED verdict.
              notes.push('A candidate matched on name and state, but the ' +
                'date of birth disagreed, so the match could not be ' +
                'confirmed. The candidate is reported for manual review.');
              return {
                verdict: 'UNVERIFIED',
                match: 'name_state',
                dobStatus: 'mismatch',
                exclusion: {
                  type: candidate.excltype,
                  date: formatLeieDate(candidate.excldate),
                  source: candidate.source,
                  asOf: formatAsOf(candidate.as_of)
                },
                reinstated: null,
                notes
              };
            }
            notes.push('Name and state matched an active LEIE record, but ' +
              'the LEIE record carries no date of birth, so the DOB could ' +
              'not be confirmed against this record.');
            return {
              verdict: 'EXCLUDED',
              match: 'name_state',
              dobStatus: 'unavailable',
              exclusion: {
                type: candidate.excltype,
                date: formatLeieDate(candidate.excldate),
                source: candidate.source,
                asOf: formatAsOf(candidate.as_of)
              },
              reinstated: null,
              notes
            };
          }

          return {
            verdict: 'EXCLUDED',
            match: 'name_state',
            dobStatus: 'not_provided',
            exclusion: {
              type: candidate.excltype,
              date: formatLeieDate(candidate.excldate),
              source: candidate.source,
              asOf: formatAsOf(candidate.as_of)
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
            dobStatus: null,
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
        return { verdict: 'CLEAR', match: 'name_state', dobStatus: null, exclusion: null, reinstated: null, notes };
      }

      // 3. Neither a valid NPI nor a usable name/state identity: UNVERIFIED.
      if (npi && !isValidNpi(npi)) {
        notes.push(`NPI "${npi}" is not a usable 10-digit NPI.`);
      }
      notes.push('No valid NPI and no usable lastname, firstname, and state ' +
        'were supplied, so no definitive check could be performed.');
      return { verdict: 'UNVERIFIED', match: null, dobStatus: null, exclusion: null, reinstated: null, notes };
    } catch (error) {
      logger.error('Error resolving exclusion:', error);
      notes.push('The exclusion database query failed; status could not be ' +
        'verified. A miss is never assumed when the check cannot complete.');
      return { verdict: 'UNVERIFIED', match: null, dobStatus: null, exclusion: null, reinstated: null, notes };
    }
  }
}

module.exports = ExclusionService;
// Shared NPI-path helpers for batched scans (intelligenceService) so the
// decision rules stay defined once.
module.exports.verdictFromNpiRow = verdictFromNpiRow;
module.exports.isValidNpi = isValidNpi;
module.exports.formatAsOf = formatAsOf;
module.exports.formatLeieDate = formatLeieDate;
