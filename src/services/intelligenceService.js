const db = require('../config/database');
const { logger } = require('../utils/logger');
const {
  verdictFromNpiRow,
  isValidNpi,
  formatAsOf,
  formatLeieDate
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
        // Filter on the same value the row displays: the crosswalk label when
        // the code resolves, the stored description otherwise.
        conditions.push(
          `lower(COALESCE(t.description, p.primary_taxonomy_description)) LIKE $${params.length}`
        );
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
          p.name_full, p.practice_city,
          COALESCE(t.description, p.primary_taxonomy_description)
            AS primary_taxonomy_description,
          p.practice_state, p.sync_timestamp,
          m.performance_year, m.final_score, m.sync_timestamp AS mips_sync_timestamp
        FROM providers p
        LEFT JOIN taxonomy_codes t ON t.code = p.primary_taxonomy_code
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
