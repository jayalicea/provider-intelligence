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
      registry: 'LEIE',
      type: row.excltype,
      date: formatLeieDate(row.excldate),
      source: row.source,
      asOf: formatAsOf(row.as_of)
    },
    reinstated: null,
    notes
  };
};

// --- state Medicaid exclusion lists ----------------------------------------
//
// state_exclusions carries no first/last split and no date of birth: one
// entity_name per row, plus state, source_name, source_url and as_of. Two
// consequences for the matcher, both deliberate:
//
//   - the name fallback compares the normalized entity_name against both
//     "LAST, FIRST" and "FIRST LAST", since states publish either;
//   - a name-matched state row can never confirm a date of birth, so it
//     carries dobStatus 'unavailable', exactly as a LEIE row with no DOB does.
//
// reinstatement_date is a real date column here, so an active row is simply
// one where it is null.
const stateRowIsActive = r => r.reinstatement_date === null || r.reinstatement_date === undefined;

const formatStateDate = v => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v === null || v === undefined || v === '' ? null : String(v);
};

// A state hit cites the publishing list, not just "a state list".
const stateExclusionPayload = row => ({
  registry: 'STATE',
  type: row.exclusion_type || null,
  date: formatStateDate(row.exclusion_date),
  state: row.state || null,
  sourceName: row.source_name || null,
  sourceUrl: row.source_url || null,
  source: row.source_name || 'State Medicaid exclusion list',
  asOf: formatAsOf(row.as_of)
});

const nameVariants = (lastname, firstname) => {
  const l = normalize(lastname);
  const f = normalize(firstname);
  if (!l || !f) return [];
  return [`${l}, ${f}`, `${f} ${l}`, `${l} ${f}`];
};

class ExclusionService {

  /**
   * Resolve one identity against oig_exclusions.
   * input: { npi, lastname, firstname, state, dob }
   * Returns { verdict, match, exclusion, reinstated, notes } where verdict is
   * EXCLUDED, CLEAR, or UNVERIFIED.
   */
  async resolveLeieExclusion({ npi = null, lastname = null, firstname = null, state = null, dob = null } = {}) {
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
                  registry: 'LEIE',
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
                  registry: 'LEIE',
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
                registry: 'LEIE',
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
              registry: 'LEIE',
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

  /**
   * Resolve a business entity against both exclusion registries.
   *
   * There was no organization path before this: oig_exclusions.busname is
   * populated for excluded businesses but nothing queried it, so an entity
   * could only ever be screened by NPI. This adds the name path and expands it
   * over the entity's doing-business-as aliases.
   *
   * Rosters routinely carry the DBA rather than the legal business name, and
   * NPPES keeps DBAs in the othername reference file (type code 3), so
   * screening only the legal name is a false clear waiting to happen. Every
   * alias is screened and the result reports which name actually matched.
   *
   * Organizations have no date of birth, so dobStatus is null throughout and
   * the match basis is reported instead.
   *
   * input: { npi, organizationName, state }
   */
  async resolveEntityExclusion({ npi = null, organizationName = null, state = null } = {}) {
    const notes = [];
    try {
      // 1. NPI exact match stays definitive for entities too.
      if (isValidNpi(npi)) {
        const leie = await this.resolveLeieExclusion({ npi });
        const stateHit = await this.resolveStateExclusion({ npi });
        if (leie.verdict === 'EXCLUDED') {
          return { ...leie, matchedName: null, matchedVia: 'npi',
            stateExclusion: stateHit.verdict === 'EXCLUDED' ? stateHit.exclusion : null,
            notes: [...leie.notes, ...stateHit.notes] };
        }
        if (stateHit.verdict === 'EXCLUDED') {
          return { ...stateHit, matchedName: null, matchedVia: 'npi',
            stateExclusion: stateHit.exclusion,
            notes: [...leie.notes, ...stateHit.notes] };
        }
      }

      // 2. Name path over the legal name plus every DBA alias.
      const aliases = [];
      if (isValidNpi(npi)) {
        const r = await db.query(
          "SELECT other_name FROM nppes_othernames WHERE npi = $1 AND other_name_type_code = '3'",
          [npi]
        );
        for (const row of r.rows || []) {
          const n = normalize(row.other_name);
          if (n) aliases.push(n);
        }
      }

      const legal = normalize(organizationName);
      const candidates = [...new Set([legal, ...aliases].filter(Boolean))];
      if (!candidates.length) {
        notes.push('No valid NPI and no usable organization name were supplied, ' +
          'so no definitive entity check could be performed.');
        return { verdict: 'UNVERIFIED', match: null, dobStatus: null, matchedName: null,
          matchedVia: null, exclusion: null, stateExclusion: null, reinstated: null, notes };
      }
      if (aliases.length) {
        notes.push(`Screened the legal business name plus ${aliases.length} ` +
          `doing-business-as alias${aliases.length === 1 ? '' : 'es'} from NPPES.`);
      }

      const nState = normalize(state);
      const params = [candidates];
      let stateClause = '';
      if (nState) { params.push(nState); stateClause = ' AND upper(state) = $2'; }

      const leieRows = await db.query(
        "SELECT busname, state, excltype, excldate, reindate, source, as_of FROM oig_exclusions " +
        "WHERE upper(regexp_replace(busname, '[^A-Z0-9 ]', '', 'g')) = ANY($1)" + stateClause,
        params
      );
      const leieMatches = (leieRows.rows || []).filter(r => candidates.includes(normalize(r.busname)));
      const leieActive = leieMatches.find(r => !isReinstated(r));

      const stateRows = await db.query(
        "SELECT * FROM state_exclusions WHERE upper(regexp_replace(entity_name, '[^A-Z0-9 ,]', '', 'g')) = ANY($1)" +
        (nState ? ' AND upper(state) = $2' : ''),
        params
      );
      const stateMatches = (stateRows.rows || []).filter(r => candidates.includes(normalize(r.entity_name)));
      const stateActive = stateMatches.find(stateRowIsActive);

      const via = name => (normalize(name) === legal ? 'legal_name' : 'dba_alias');
      const aliasNote = name => {
        if (via(name) === 'dba_alias') {
          notes.push('Matched on a doing-business-as alias rather than the legal ' +
            'business name.');
        }
      };

      if (leieActive) {
        aliasNote(leieActive.busname);
        return {
          verdict: 'EXCLUDED', match: nState ? 'name_state' : 'name', dobStatus: null,
          matchedName: leieActive.busname, matchedVia: via(leieActive.busname),
          exclusion: {
            registry: 'LEIE', type: leieActive.excltype,
            date: formatLeieDate(leieActive.excldate),
            source: leieActive.source, asOf: formatAsOf(leieActive.as_of)
          },
          stateExclusion: stateActive ? stateExclusionPayload(stateActive) : null,
          reinstated: null, notes
        };
      }
      if (stateActive) {
        aliasNote(stateActive.entity_name);
        return {
          verdict: 'EXCLUDED', match: nState ? 'name_state' : 'name', dobStatus: null,
          matchedName: stateActive.entity_name, matchedVia: via(stateActive.entity_name),
          exclusion: stateExclusionPayload(stateActive),
          stateExclusion: stateExclusionPayload(stateActive),
          reinstated: null, notes
        };
      }

      const reinstatedRow = leieMatches[0] || stateMatches[0] || null;
      if (reinstatedRow) {
        const isLeie = leieMatches.length > 0;
        const matched = isLeie ? reinstatedRow.busname : reinstatedRow.entity_name;
        notes.push('A prior exclusion matched this entity by name, but it has ' +
          'been reinstated; treated as clear as of the reinstatement date shown.');
        return {
          verdict: 'CLEAR', match: nState ? 'name_state' : 'name', dobStatus: null,
          matchedName: matched, matchedVia: via(matched),
          exclusion: null, stateExclusion: null,
          reinstated: isLeie
            ? { registry: 'LEIE', date: formatLeieDate(reinstatedRow.reindate),
              source: reinstatedRow.source, asOf: formatAsOf(reinstatedRow.as_of) }
            : { registry: 'STATE', date: formatStateDate(reinstatedRow.reinstatement_date),
              state: reinstatedRow.state || null,
              source: reinstatedRow.source_name || 'State Medicaid exclusion list',
              asOf: formatAsOf(reinstatedRow.as_of) },
          notes
        };
      }

      notes.push('No exclusion record found for this entity name or its ' +
        'doing-business-as aliases in the LEIE or the state lists.');
      return { verdict: 'CLEAR', match: nState ? 'name_state' : 'name', dobStatus: null,
        matchedName: null, matchedVia: null, exclusion: null, stateExclusion: null,
        reinstated: null, notes };
    } catch (error) {
      logger.error('Error resolving entity exclusion:', error);
      notes.push('The entity exclusion query failed; status could not be ' +
        'verified. A miss is never assumed when the check cannot complete.');
      return { verdict: 'UNVERIFIED', match: null, dobStatus: null, matchedName: null,
        matchedVia: null, exclusion: null, stateExclusion: null, reinstated: null, notes };
    }
  }

  /**
   * Resolve one identity against state_exclusions, mirroring the LEIE paths:
   * NPI exact match first, then name + state. Returns the same verdict shape
   * with exclusion.registry === 'STATE'.
   */
  async resolveStateExclusion({ npi = null, lastname = null, firstname = null, state = null } = {}) {
    const notes = [];
    try {
      if (isValidNpi(npi)) {
        const result = await db.query(
          'SELECT * FROM state_exclusions WHERE npi = $1',
          [npi]
        );
        const rows = result.rows || [];
        const active = rows.find(stateRowIsActive);
        if (active) {
          notes.push(`Matched by NPI on the ${active.source_name || 'state'} exclusion list.`);
          return {
            verdict: 'EXCLUDED', match: 'npi', dobStatus: null,
            exclusion: stateExclusionPayload(active), reinstated: null, notes
          };
        }
        if (rows.length) {
          notes.push('A prior state exclusion matched by NPI, but it has been ' +
            'reinstated; treated as clear as of the reinstatement date shown.');
          return {
            verdict: 'CLEAR', match: 'npi', dobStatus: null, exclusion: null,
            reinstated: {
              registry: 'STATE',
              date: formatStateDate(rows[0].reinstatement_date),
              state: rows[0].state || null,
              source: rows[0].source_name || 'State Medicaid exclusion list',
              asOf: formatAsOf(rows[0].as_of)
            },
            notes
          };
        }
        return {
          verdict: 'CLEAR', match: 'npi', dobStatus: null,
          exclusion: null, reinstated: null, notes
        };
      }

      const variants = nameVariants(lastname, firstname);
      const nState = normalize(state);
      if (variants.length && nState) {
        const result = await db.query(
          "SELECT * FROM state_exclusions WHERE upper(regexp_replace(entity_name, '[^A-Z0-9 ,]', '', 'g')) = ANY($1) AND upper(state) = $2",
          [variants, nState]
        );
        const rows = (result.rows || []).filter(r =>
          variants.includes(normalize(r.entity_name)) && normalize(r.state) === nState
        );
        const active = rows.find(stateRowIsActive);
        if (active) {
          // State lists carry no date of birth, so a name match here can never
          // be DOB-confirmed. Reported as 'unavailable' rather than silently
          // treated as a confirmed identity.
          notes.push(`Matched by name and state on the ${active.source_name || 'state'} ` +
            'exclusion list. State lists carry no date of birth, so the ' +
            'identity could not be DOB-confirmed.');
          return {
            verdict: 'EXCLUDED', match: 'name_state', dobStatus: 'unavailable',
            exclusion: stateExclusionPayload(active), reinstated: null, notes
          };
        }
        if (rows.length) {
          notes.push('A prior state exclusion matched by name and state, but ' +
            'it has been reinstated; treated as clear as of the reinstatement ' +
            'date shown.');
          return {
            verdict: 'CLEAR', match: 'name_state', dobStatus: null, exclusion: null,
            reinstated: {
              registry: 'STATE',
              date: formatStateDate(rows[0].reinstatement_date),
              state: rows[0].state || null,
              source: rows[0].source_name || 'State Medicaid exclusion list',
              asOf: formatAsOf(rows[0].as_of)
            },
            notes
          };
        }
        return {
          verdict: 'CLEAR', match: 'name_state', dobStatus: null,
          exclusion: null, reinstated: null, notes
        };
      }

      return { verdict: 'UNVERIFIED', match: null, dobStatus: null, exclusion: null, reinstated: null, notes };
    } catch (error) {
      logger.error('Error resolving state exclusion:', error);
      notes.push('The state exclusion query failed; the state lists could not ' +
        'be checked. A miss is never assumed when the check cannot complete.');
      return { verdict: 'UNVERIFIED', match: null, dobStatus: null, exclusion: null, reinstated: null, notes };
    }
  }

  /**
   * Combined verdict across the federal LEIE and the state Medicaid lists.
   *
   * Merge follows prefer-miss-over-false-clear: any EXCLUDED wins, then any
   * UNVERIFIED, and CLEAR only when both registries came back clear. A federal
   * hit is cited as the primary exclusion when both fire, because the LEIE is
   * the stronger signal, but the state hit is still reported in stateExclusion
   * so neither is hidden by the other.
   */
  async resolveExclusion(identity = {}) {
    const leie = await this.resolveLeieExclusion(identity);
    const state = await this.resolveStateExclusion(identity);

    const notes = [...leie.notes, ...state.notes];
    const stateHit = state.verdict === 'EXCLUDED' ? state.exclusion : null;

    if (leie.verdict === 'EXCLUDED') {
      return { ...leie, notes, stateExclusion: stateHit };
    }
    if (state.verdict === 'EXCLUDED') {
      return { ...state, notes, stateExclusion: stateHit };
    }
    if (leie.verdict === 'UNVERIFIED' || state.verdict === 'UNVERIFIED') {
      const base = leie.verdict === 'UNVERIFIED' ? leie : state;
      return { ...base, verdict: 'UNVERIFIED', notes, stateExclusion: null };
    }
    // Both clear. A reinstatement is why one of them is clear, so keep it
    // rather than letting the other registry's empty result hide it.
    return {
      ...leie,
      reinstated: leie.reinstated || state.reinstated || null,
      notes,
      stateExclusion: null
    };
  }
}

module.exports = ExclusionService;
// Shared NPI-path helpers for batched scans (intelligenceService) so the
// decision rules stay defined once.
module.exports.verdictFromNpiRow = verdictFromNpiRow;
module.exports.isValidNpi = isValidNpi;
module.exports.formatAsOf = formatAsOf;
