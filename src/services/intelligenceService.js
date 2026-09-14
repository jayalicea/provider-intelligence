const db = require('../config/database');
const { logger } = require('../utils/logger');
const {
  verdictFromNpiRow,
  isValidNpi,
  formatAsOf,
  formatLeieDate,
  stateExclusionPayload
} = require('./exclusionService');

// Watchlist window bounds, shared with the controller's validation.
const WATCHLIST_DEFAULT_DAYS = 90;
const WATCHLIST_MAX_DAYS = 365;
const WATCHLIST_MAX_ROWS = 500;
const ROSTER_MAX_ROWS = 1000;

// excldate is YYYYMMDD text, so the cutoff is compared as the same zero-padded
// string rather than cast per row.
const yyyymmdd = date => {
  const p = n => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`;
};

const isReinstatedRow = row => {
  const r = row.reindate;
  return r !== null && r !== undefined && String(r).trim() !== '' &&
    String(r).trim() !== '00000000';
};

const num = v => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

class IntelligenceService {

  /**
   * Joined cohort view: providers in a state, their latest-year MIPS score,
   * and a batched LEIE exclusion verdict per provider.
   * filters: { state (required, 2-letter), taxonomy (optional substring),
   *            minScore (optional 0-100, excludes null final scores) }
   */
  async getCohort({ state, taxonomy = null, minScore = null }) {
    try {
      const conditions = ['upper(p.practice_state) = $1'];
      const params = [state.toUpperCase()];
      if (taxonomy) {
        params.push(`%${taxonomy.toLowerCase()}%`);
        conditions.push(`lower(p.primary_taxonomy_description) LIKE $${params.length}`);
      }
      if (minScore !== null) {
        // Null final scores can never satisfy the threshold, so this filter
        // naturally excludes unscored providers (never a false comparison).
        params.push(minScore);
        conditions.push(`m.final_score >= $${params.length}`);
      }

      const query = `
        SELECT
          p.npi, p.name_first, p.name_middle, p.name_last, p.name_credential,
          p.name_full, p.primary_taxonomy_description, p.practice_city,
          p.practice_state, p.sync_timestamp,
          m.performance_year, m.final_score, m.sync_timestamp AS mips_sync_timestamp
        FROM providers p
        LEFT JOIN mips_performance_scores m
          ON m.npi = p.npi
         AND m.performance_year = (
           SELECT MAX(performance_year) FROM mips_performance_scores
           WHERE npi = p.npi
         )
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.name_last ASC, p.name_first ASC, p.npi ASC
        LIMIT 500
      `;

      const result = await db.query(query, params);
      const rows = result.rows;

      // Batch the exclusion scan: one query for every candidate NPI, plus
      // one for the table-wide as_of used as provenance on CLEAR-by-scan rows.
      const npis = rows.map(r => String(r.npi));
      const [exclusionResult, maxAsOfResult] = await Promise.all([
        db.query('SELECT * FROM oig_exclusions WHERE npi = ANY($1)', [npis]),
        db.query('SELECT max(as_of) AS as_of FROM oig_exclusions')
      ]);
      const defaultAsOf = maxAsOfResult.rows[0]
        ? formatAsOf(maxAsOfResult.rows[0].as_of)
        : null;

      const byNpi = new Map();
      for (const row of exclusionResult.rows || []) {
        const key = String(row.npi);
        if (!byNpi.has(key)) byNpi.set(key, []);
        byNpi.get(key).push(row);
      }

      return rows.map(row => {
        const npi = String(row.npi);
        let exclusion;
        let exclusionAsOf = defaultAsOf;

        if (!isValidNpi(npi)) {
          exclusion = {
            verdict: 'UNVERIFIED',
            match: null,
            dobStatus: null,
            exclusion: null,
            reinstated: null,
            notes: [`NPI "${npi}" is not a usable 10-digit NPI; exclusion status could not be verified.`]
          };
        } else {
          const matches = byNpi.get(npi) || [];
          const active = matches.find(r => !isReinstatedRow(r));
          const chosen = active || matches[0] || null;
          exclusion = verdictFromNpiRow(chosen, []);
          if (chosen) exclusionAsOf = exclusion.exclusion
            ? exclusion.exclusion.asOf
            : (exclusion.reinstated ? exclusion.reinstated.asOf : defaultAsOf);
        }

        return {
          npi,
          name: row.name_full ||
            [row.name_first, row.name_middle, row.name_last]
              .filter(Boolean).join(' ') || null,
          taxonomy: row.primary_taxonomy_description || null,
          city: row.practice_city || null,
          state: row.practice_state || null,
          finalScore: num(row.final_score),
          exclusion,
          provenance: {
            identityAsOf: formatAsOf(row.sync_timestamp),
            mipsAsOf: row.performance_year !== null && row.performance_year !== undefined
              ? formatAsOf(row.mips_sync_timestamp)
              : null,
            exclusionAsOf
          }
        };
      });
    } catch (error) {
      logger.error('Error building cohort intelligence:', error);
      throw new Error('Failed to build cohort intelligence');
    }
  }

  /**
   * National cohort over nppes_providers (full NPPES load) instead of the
   * legacy providers cache. Same row contract as getCohort, plus per-row
   * verdict/enrichable: a row with no exclusion record in either registry is
   * 'unscreened' and enrichable; any EXCLUDED or reinstatement-derived CLEAR
   * is final and not enrichable.
   *
   * filters: { state (required 2-letter), taxonomy (optional code prefix),
   *            name (optional space-separated terms, OR'd across name
   *            columns, case-insensitive substring), minScore (optional) }
   */
  async getNationalCohort({ state, taxonomy = null, name = null, minScore = null }) {
    try {
      const conditions = ['upper(p.practice_state) = $1'];
      const params = [state.toUpperCase()];
      if (taxonomy) {
        params.push(`${taxonomy.toUpperCase()}%`);
        conditions.push(`p.primary_taxonomy_code LIKE $${params.length}`);
      }
      if (name) {
        for (const term of String(name).split(/\s+/).filter(Boolean)) {
          params.push(`%${term.toLowerCase()}%`);
          const i = params.length;
          conditions.push(
            `(lower(p.last_name) LIKE $${i}` +
            ` OR lower(p.first_name) LIKE $${i}` +
            ` OR lower(p.legal_business_name) LIKE $${i})`
          );
        }
      }
      if (minScore !== null) {
        params.push(minScore);
        conditions.push(`m.final_score >= $${params.length}`);
      }

      const query = `
        SELECT
          p.npi, p.entity_type_code, p.first_name,
          p.middle_name, p.last_name,
          p.legal_business_name, p.practice_city,
          p.practice_state, p.primary_taxonomy_code,
          p.as_of,
          m.performance_year, m.final_score, m.sync_timestamp AS mips_sync_timestamp
        FROM nppes_providers p
        LEFT JOIN mips_performance_scores m
          ON m.npi = p.npi
         AND m.performance_year = (
           SELECT MAX(performance_year) FROM mips_performance_scores
           WHERE npi = p.npi
         )
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.npi ASC
        LIMIT 500
      `;

      const result = await db.query(query, params);
      const rows = result.rows;

      const npis = rows.map(r => String(r.npi));
      const [exclusionResult, stateResult, maxAsOfResult] = await Promise.all([
        db.query('SELECT * FROM oig_exclusions WHERE npi = ANY($1)', [npis]),
        db.query('SELECT * FROM state_exclusions WHERE npi = ANY($1)', [npis]),
        db.query('SELECT max(as_of) AS as_of FROM oig_exclusions')
      ]);
      const defaultAsOf = maxAsOfResult.rows[0]
        ? formatAsOf(maxAsOfResult.rows[0].as_of)
        : null;

      const groupByNpi = sourceRows => {
        const map = new Map();
        for (const row of sourceRows || []) {
          const key = String(row.npi);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(row);
        }
        return map;
      };
      const leieByNpi = groupByNpi(exclusionResult.rows);
      const stateByNpi = groupByNpi(stateResult.rows);

      return rows.map(row => {
        const npi = String(row.npi);
        let exclusion;
        let exclusionAsOf = defaultAsOf;
        let verdict;
        let enrichable;

        const leieRows = leieByNpi.get(npi) || [];
        const active = leieRows.find(r => !isReinstatedRow(r));
        const chosen = active || leieRows[0] || null;

        if (chosen) {
          // Registry LEIE verdict, exactly as the cached cohort builds it.
          exclusion = verdictFromNpiRow(chosen, []);
          exclusionAsOf = exclusion.exclusion
            ? exclusion.exclusion.asOf
            : (exclusion.reinstated ? exclusion.reinstated.asOf : defaultAsOf);
        } else {
          const sRows = stateByNpi.get(npi) || [];
          const sActive = sRows.find(r =>
            r.reinstatement_date === null || r.reinstatement_date === undefined);
          const sChosen = sActive || sRows[0] || null;
          if (sChosen) {
            exclusionAsOf = formatAsOf(sChosen.as_of);
            if (sActive) {
              exclusion = {
                verdict: 'EXCLUDED', match: 'npi', dobStatus: null,
                exclusion: stateExclusionPayload(sChosen),
                reinstated: null, notes: []
              };
            } else {
              exclusion = {
                verdict: 'CLEAR', match: 'npi', dobStatus: null,
                exclusion: null,
                reinstated: {
                  registry: 'STATE',
                  date: sChosen.reinstatement_date instanceof Date
                    ? sChosen.reinstatement_date.toISOString().slice(0, 10)
                    : String(sChosen.reinstatement_date),
                  state: sChosen.state || null,
                  source: sChosen.source_name || 'State Medicaid exclusion list',
                  asOf: formatAsOf(sChosen.as_of)
                },
                notes: []
              };
            }
          } else {
            // No record in either registry: the scan found nothing, but the
            // row is still open to deeper (name/DOB) enrichment.
            exclusion = verdictFromNpiRow(null, []);
          }
        }

        if (exclusion.verdict === 'EXCLUDED') {
          verdict = 'EXCLUDED';
          enrichable = false;
        } else if (exclusion.reinstated) {
          verdict = 'CLEAR';
          enrichable = false;
        } else if (chosen) {
          // LEIE row existed but was reinstated: registry match, final clear.
          verdict = 'CLEAR';
          enrichable = false;
        } else {
          verdict = 'unscreened';
          enrichable = true;
        }

        const name = row.entity_type_code === '2'
          ? row.legal_business_name || null
          : [row.first_name, row.middle_name, row.last_name]
              .filter(Boolean).join(' ') || null;

        return {
          npi,
          name,
          taxonomy: row.primary_taxonomy_code || null,
          city: row.practice_city || null,
          state: row.practice_state || null,
          finalScore: num(row.final_score),
          verdict,
          enrichable,
          exclusion,
          provenance: {
            identityAsOf: formatAsOf(row.as_of),
            mipsAsOf: row.performance_year !== null && row.performance_year !== undefined
              ? formatAsOf(row.mips_sync_timestamp)
              : null,
            exclusionAsOf
          }
        };
      });
    } catch (error) {
      logger.error('Error building national cohort intelligence:', error);
      throw new Error('Failed to build cohort intelligence');
    }
  }

  /**
   * Screen a roster of identities against both exclusion registries.
   *
   * Rows arrive already parsed -- the client reads the CSV, so nothing is
   * uploaded and no file ever touches the server. Each row is resolved
   * independently and a row that throws comes back UNVERIFIED with the reason,
   * never silently dropped and never assumed clear, so one malformed row can
   * never quietly pass a whole roster.
   *
   * rows: [{ npi, lastname, firstname, state, dob, organizationName }]
   */
  async screenRoster(rows = []) {
    const ExclusionService = require('./exclusionService');
    const service = new ExclusionService();
    const counts = { EXCLUDED: 0, CLEAR: 0, UNVERIFIED: 0 };
    const results = [];

    for (const row of rows.slice(0, ROSTER_MAX_ROWS)) {
      let result;
      try {
        result = row.organizationName && !row.lastname
          ? await service.resolveEntityExclusion({
            npi: row.npi || null,
            organizationName: row.organizationName,
            state: row.state || null
          })
          : await service.resolveExclusion({
            npi: row.npi || null,
            lastname: row.lastname || null,
            firstname: row.firstname || null,
            state: row.state || null,
            dob: row.dob || null
          });
      } catch (error) {
        logger.error('Roster row could not be resolved:', error);
        result = {
          verdict: 'UNVERIFIED', match: null, dobStatus: null, exclusion: null,
          stateExclusion: null, reinstated: null,
          notes: [`This row could not be resolved: ${error.message}`]
        };
      }
      counts[result.verdict] = (counts[result.verdict] || 0) + 1;
      results.push({
        input: {
          npi: row.npi || null,
          name: row.organizationName ||
            [row.lastname, row.firstname].filter(Boolean).join(', ') || null,
          state: row.state || null
        },
        verdict: result.verdict,
        match: result.match || null,
        dobStatus: result.dobStatus || null,
        exclusion: result.exclusion || null,
        stateExclusion: result.stateExclusion || null,
        reinstated: result.reinstated || null,
        notes: result.notes || []
      });
    }

    return {
      counts,
      screened: results.length,
      submitted: rows.length,
      truncated: rows.length > ROSTER_MAX_ROWS,
      results
    };
  }

  /**
   * Recently added, still-active LEIE exclusions -- the screening watchlist.
   *
   * Active means reindate IS NULL: the ingest normalizes LEIE's '00000000' and
   * empty reinstatement dates to null, so a null reindate is an exclusion that
   * has not been lifted. The window is applied to excldate, which is YYYYMMDD
   * text, so the cutoff is compared as a string of the same shape.
   *
   * filters: { state (optional 2-letter), days (1..365, default 90) }
   */
  async getExclusionWatchlist({ state = null, days = WATCHLIST_DEFAULT_DAYS } = {}) {
    try {
      const window = Math.min(Math.max(parseInt(days, 10) || WATCHLIST_DEFAULT_DAYS, 1), WATCHLIST_MAX_DAYS);
      const cutoff = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

      const params = [yyyymmdd(cutoff)];
      const conditions = [
        'reindate IS NULL',
        "excldate ~ '^[0-9]{8}$'",
        'excldate >= $1'
      ];
      if (state) {
        params.push(state.toUpperCase());
        conditions.push(`upper(state) = $${params.length}`);
      }
      params.push(WATCHLIST_MAX_ROWS);

      const query = `
        SELECT display_name, lastname, firstname, busname, npi, city, state, zip,
               excltype, general, specialty, excldate, source, as_of
        FROM oig_exclusions
        WHERE ${conditions.join(' AND ')}
        ORDER BY excldate DESC, display_name ASC
        LIMIT $${params.length}`;

      const result = await db.query(query, params);

      return {
        windowDays: window,
        state: state ? state.toUpperCase() : null,
        capped: result.rows.length >= WATCHLIST_MAX_ROWS,
        rows: result.rows.map(row => ({
          name: row.display_name ||
            row.busname ||
            [row.lastname, row.firstname].filter(Boolean).join(', ') ||
            null,
          entityType: row.busname ? 'ORGANIZATION' : 'INDIVIDUAL',
          npi: isValidNpi(row.npi) ? row.npi : null,
          city: row.city || null,
          state: row.state || null,
          zip: row.zip || null,
          exclusionType: row.excltype || null,
          exclusionDate: formatLeieDate(row.excldate),
          // Provenance travels with the row: which file it came from and the
          // vintage of that file, so a stale list is visible per entry.
          source: row.source,
          asOf: formatAsOf(row.as_of)
        }))
      };
    } catch (error) {
      logger.error('Error building exclusion watchlist:', error);
      throw error;
    }
  }
}

module.exports = IntelligenceService;
module.exports.WATCHLIST_DEFAULT_DAYS = WATCHLIST_DEFAULT_DAYS;
module.exports.WATCHLIST_MAX_DAYS = WATCHLIST_MAX_DAYS;
module.exports.WATCHLIST_MAX_ROWS = WATCHLIST_MAX_ROWS;
module.exports.ROSTER_MAX_ROWS = ROSTER_MAX_ROWS;
