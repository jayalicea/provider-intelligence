const db = require('../config/database');
const { logger } = require('../utils/logger');
const {
  verdictFromNpiRow,
  isValidNpi,
  formatAsOf
} = require('./exclusionService');

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
}

module.exports = IntelligenceService;
