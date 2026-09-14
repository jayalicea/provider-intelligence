const db = require('../config/database');
const { logger } = require('../utils/logger');
const {
  verdictFromNpiRow,
  isValidNpi,
  formatAsOf,
  formatLeieDate,
  normalize,
  isReinstated,
  stateRowIsActive,
  stateExclusionPayload,
  nameVariants
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

      // Batch the exclusion scan. Five queries total, whatever the row count:
      // the cohort itself, an NPI pass against each registry, the table-wide
      // as_of used as provenance on CLEAR-by-scan rows, and one name-keyed
      // pass covering both registries for rows the NPI pass cannot decide.
      // Resolving per row instead would cost at least two queries per row.
      const npis = rows.map(r => String(r.npi));

      // Name keys are only needed for rows without a usable NPI -- an NPI match
      // is definitive, exactly as in resolveExclusion, so a row with a valid
      // NPI never reaches the name pass.
      const nameRows = rows.filter(r => !isValidNpi(String(r.npi)));
      const lastNames = [...new Set(nameRows.map(r => normalize(r.name_last)).filter(Boolean))];
      const states = [...new Set(nameRows.map(r => normalize(r.practice_state)).filter(Boolean))];
      const entityNames = [...new Set(
        nameRows.flatMap(r => nameVariants(r.name_last, r.name_first))
      )];

      const [exclusionResult, stateResult, maxAsOfResult, nameResult, stateNameResult] =
        await Promise.all([
          db.query('SELECT * FROM oig_exclusions WHERE npi = ANY($1)', [npis]),
          db.query('SELECT * FROM state_exclusions WHERE npi = ANY($1)', [npis]),
          db.query('SELECT max(as_of) AS as_of FROM oig_exclusions'),
          lastNames.length && states.length
            ? db.query(
              "SELECT * FROM oig_exclusions WHERE upper(regexp_replace(lastname, '[^A-Z0-9 ]', '', 'g')) = ANY($1) AND upper(state) = ANY($2)",
              [lastNames, states]
            )
            : Promise.resolve({ rows: [] }),
          entityNames.length && states.length
            ? db.query(
              "SELECT * FROM state_exclusions WHERE upper(regexp_replace(entity_name, '[^A-Z0-9 ,]', '', 'g')) = ANY($1) AND upper(state) = ANY($2)",
              [entityNames, states]
            )
            : Promise.resolve({ rows: [] })
        ]);

      const defaultAsOf = maxAsOfResult.rows[0]
        ? formatAsOf(maxAsOfResult.rows[0].as_of)
        : null;

      const groupBy = (result, keyOf) => {
        const map = new Map();
        for (const row of result.rows || []) {
          const key = keyOf(row);
          if (key === null) continue;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(row);
        }
        return map;
      };

      const byNpi = groupBy(exclusionResult, r => String(r.npi));
      const stateByNpi = groupBy(stateResult, r => String(r.npi));
      const leieByName = groupBy(nameResult, r => {
        const last = normalize(r.lastname);
        const first = normalize(r.firstname);
        const state = normalize(r.state);
        return last && first && state ? `${last}|${first}|${state}` : null;
      });
      const stateByName = groupBy(stateNameResult, r => {
        const name = normalize(r.entity_name);
        const state = normalize(r.state);
        return name && state ? `${name}|${state}` : null;
      });

      // Mirrors the state branch of resolveExclusion for one grouped row set.
      const stateVerdict = matches => {
        const active = (matches || []).find(stateRowIsActive);
        if (active) return { verdict: 'EXCLUDED', payload: stateExclusionPayload(active) };
        return { verdict: 'CLEAR', payload: null };
      };

      return rows.map(row => {
        const npi = String(row.npi);
        let exclusion;
        let exclusionAsOf = defaultAsOf;

        if (isValidNpi(npi)) {
          // NPI pass. Definitive, so the name pass is never consulted here.
          const matches = byNpi.get(npi) || [];
          const active = matches.find(r => !isReinstatedRow(r));
          const chosen = active || matches[0] || null;
          const leie = verdictFromNpiRow(chosen, []);
          const state = stateVerdict(stateByNpi.get(npi));

          if (leie.verdict === 'EXCLUDED') {
            exclusion = { ...leie, stateExclusion: state.payload };
          } else if (state.verdict === 'EXCLUDED') {
            exclusion = {
              verdict: 'EXCLUDED',
              match: 'npi',
              dobStatus: null,
              exclusion: state.payload,
              stateExclusion: state.payload,
              reinstated: null,
              notes: [`Matched by NPI on the ${state.payload.sourceName || 'state'} exclusion list.`]
            };
          } else {
            exclusion = { ...leie, stateExclusion: null };
          }

          const cited = exclusion.exclusion || exclusion.reinstated;
          if (cited) exclusionAsOf = cited.asOf || defaultAsOf;
        } else {
          // Name-keyed pass: the cohort carries no date of birth, so a match
          // here reports dobStatus 'not_provided', the same value
          // resolveExclusion returns when no DOB was supplied.
          const last = normalize(row.name_last);
          const first = normalize(row.name_first);
          const state = normalize(row.practice_state);

          if (!last || !first || !state) {
            exclusion = {
              verdict: 'UNVERIFIED',
              match: null,
              dobStatus: null,
              exclusion: null,
              stateExclusion: null,
              reinstated: null,
              notes: [`NPI "${npi}" is not a usable 10-digit NPI, and no usable name and state were cached, so exclusion status could not be verified.`]
            };
          } else {
            const leieMatches = leieByName.get(`${last}|${first}|${state}`) || [];
            const leieActive = leieMatches.find(r => !isReinstated(r));
            const stateMatches = nameVariants(row.name_last, row.name_first)
              .flatMap(v => stateByName.get(`${v}|${state}`) || []);
            const stateHit = stateVerdict(stateMatches);

            if (leieActive) {
              exclusion = {
                verdict: 'EXCLUDED',
                match: 'name_state',
                dobStatus: 'not_provided',
                exclusion: {
                  registry: 'LEIE',
                  type: leieActive.excltype,
                  date: formatLeieDate(leieActive.excldate),
                  source: leieActive.source,
                  asOf: formatAsOf(leieActive.as_of)
                },
                stateExclusion: stateHit.payload,
                reinstated: null,
                notes: []
              };
            } else if (stateHit.verdict === 'EXCLUDED') {
              exclusion = {
                verdict: 'EXCLUDED',
                match: 'name_state',
                dobStatus: 'unavailable',
                exclusion: stateHit.payload,
                stateExclusion: stateHit.payload,
                reinstated: null,
                notes: ['Matched by name and state on the ' +
                  `${stateHit.payload.sourceName || 'state'} exclusion list. State ` +
                  'lists carry no date of birth, so the identity could not be ' +
                  'DOB-confirmed.']
              };
            } else if (leieMatches.length) {
              exclusion = {
                verdict: 'CLEAR',
                match: 'name_state',
                dobStatus: null,
                exclusion: null,
                stateExclusion: null,
                reinstated: {
                  date: formatLeieDate(leieMatches[0].reindate),
                  source: leieMatches[0].source,
                  asOf: formatAsOf(leieMatches[0].as_of)
                },
                notes: ['A prior exclusion record matched by name and state, ' +
                  'but it has been reinstated; treated as clear as of the ' +
                  'reinstatement date shown.']
              };
            } else {
              exclusion = {
                verdict: 'CLEAR',
                match: 'name_state',
                dobStatus: null,
                exclusion: null,
                stateExclusion: null,
                reinstated: null,
                notes: ['No exclusion record found for this name and state in the LEIE.']
              };
            }

            const cited = exclusion.exclusion || exclusion.reinstated;
            if (cited) exclusionAsOf = cited.asOf || defaultAsOf;
          }
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
