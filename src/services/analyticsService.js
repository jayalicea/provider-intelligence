const db = require('../config/database');
const { logger } = require('../utils/logger');

// phynpi.md §6 specifies these analytics; its SQL is not executable as
// printed ($0 placeholders, a nonexistent status_count column), so the
// queries below implement the same intent with valid PostgreSQL.
const num = v => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = v => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

// Decile ladder computed at read time with PERCENTILE_CONT (linear
// interpolation), the same definition the materializer stores for the
// quartiles. The runtime path issues this as SQL; computeDeciles is the
// pure reference form, kept in sync and unit tested, mirroring the
// computeAggregates pattern in tools/build-taxonomy-percentiles.js.
const DECILE_POINTS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function percentileContSorted(sorted, p) {
  if (!sorted.length) return null;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeDeciles(sortedScores) {
  const deciles = {};
  DECILE_POINTS.forEach((p, i) => {
    deciles[`d${(i + 1) * 10}`] = percentileContSorted(sortedScores, p);
  });
  return deciles;
}

// Read-time deciles are computed over the full cohort row set, not the
// stored aggregates. Per-taxonomy-year cohorts are tens of thousands of
// rows (largest measured: 54,086 in ~2s), but refuse pathological groups
// rather than let the ordered-set aggregate grind.
const MAX_LIVE_COHORT = 250000;

const DECILE_SELECT = DECILE_POINTS
  .map(p => `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY m.final_score) AS d${p * 100}`)
  .join(',\n               ');

class AnalyticsService {

  /**
   * Aggregate performance statistics for a group of providers in one year.
   * npis: array of 10-digit NPI strings.
   */
  async getGroupPerformance(npis, year) {
    try {
      if (!Array.isArray(npis) || npis.some(n => typeof n !== 'string')) {
        throw Object.assign(new Error('npis must be an array of NPI strings'), { statusCode: 400 });
      }
      if (npis.length === 0) {
        throw Object.assign(new Error('npis must not be empty'), { statusCode: 400 });
      }
      // Cap the group size so the ANY($1) query stays within postgres array
      // limits and response times stay bounded.
      npis = npis.slice(0, 5000);

      const query = `
        SELECT
          COUNT(*) AS provider_count,
          COUNT(final_score) AS scored_count,
          AVG(final_score) AS final_avg, MIN(final_score) AS final_min,
          MAX(final_score) AS final_max, STDDEV(final_score) AS final_stddev,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY final_score) AS final_p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY final_score) AS final_p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY final_score) AS final_p75,
          AVG(quality_score) AS quality_avg, MIN(quality_score) AS quality_min,
          MAX(quality_score) AS quality_max, STDDEV(quality_score) AS quality_stddev,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY quality_score) AS quality_p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY quality_score) AS quality_p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY quality_score) AS quality_p75,
          AVG(improvement_activities_score) AS ia_avg, MIN(improvement_activities_score) AS ia_min,
          MAX(improvement_activities_score) AS ia_max, STDDEV(improvement_activities_score) AS ia_stddev,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY improvement_activities_score) AS ia_p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY improvement_activities_score) AS ia_p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY improvement_activities_score) AS ia_p75,
          AVG(promoting_interoperability_score) AS pi_avg, MIN(promoting_interoperability_score) AS pi_min,
          MAX(promoting_interoperability_score) AS pi_max, STDDEV(promoting_interoperability_score) AS pi_stddev,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY promoting_interoperability_score) AS pi_p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY promoting_interoperability_score) AS pi_p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY promoting_interoperability_score) AS pi_p75,
          AVG(cost_score) AS cost_avg, MIN(cost_score) AS cost_min,
          MAX(cost_score) AS cost_max, STDDEV(cost_score) AS cost_stddev,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY cost_score) AS cost_p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY cost_score) AS cost_p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cost_score) AS cost_p75
        FROM mips_performance_scores
        WHERE performance_year = $2 AND npi = ANY($1)
      `;

      const result = await db.query(query, [npis, year]);
      const row = result.rows[0] || {};
      const providerCount = Number(row.provider_count || 0);

      const metric = prefix => ({
        avg: round2(num(row[`${prefix}_avg`])),
        min: num(row[`${prefix}_min`]),
        max: num(row[`${prefix}_max`]),
        stddev: round2(num(row[`${prefix}_stddev`])),
        percentiles: {
          p25: round2(num(row[`${prefix}_p25`])),
          p50: round2(num(row[`${prefix}_p50`])),
          p75: round2(num(row[`${prefix}_p75`]))
        }
      });

      return {
        year,
        providerCount,
        scoredCount: Number(row.scored_count || 0),
        metrics: providerCount === 0 ? null : {
          finalScore: metric('final'),
          quality: metric('quality'),
          improvementActivities: metric('ia'),
          promotingInteroperability: metric('pi'),
          cost: metric('cost')
        }
      };
    } catch (error) {
      logger.error('Error in group performance analytics:', error);
      throw new Error('Failed to generate group performance analytics');
    }
  }

  /**
   * Rank one provider against all peers (or same-taxonomy peers) for a year.
   * percentile: percentage of peers scoring at or below the provider
   * (100 = best). Returns null when the provider has no score that year.
   */
  async getRanking(npi, year, taxonomy = null) {
    try {
      const withinTaxonomy = Boolean(taxonomy);
      // Only scored rows (final_score NOT NULL) enter the window partition:
      // NULL scores must not hold rank 1 (Postgres default NULLS FIRST on
      // DESC) nor dilute the percentile denominator. The target provider is
      // LEFT-JOINed in from its own row so an unscored target still returns
      // a result with rank null rather than vanishing (404).
      const query = `
        SELECT t.npi, t.final_score, r.rank, r.total_count, r.percentile
        FROM (
          SELECT npi, final_score FROM mips_performance_scores
          WHERE npi = $1 AND performance_year = $2
        ) t
        LEFT JOIN (
          SELECT m.npi, m.final_score,
            RANK() OVER (ORDER BY m.final_score DESC NULLS LAST) AS rank,
            COUNT(m.final_score) OVER () AS total_count,
            ROUND(100.0 * COUNT(*) FILTER (WHERE m.final_score <= t2.final_score) OVER ()
                  / COUNT(m.final_score) OVER (), 2) AS percentile
          FROM mips_performance_scores m
          CROSS JOIN (
            SELECT final_score FROM mips_performance_scores
            WHERE npi = $1 AND performance_year = $2
          ) t2
          WHERE m.performance_year = $2
            AND m.final_score IS NOT NULL
            ${withinTaxonomy
              ? 'AND m.npi IN (SELECT npi FROM providers WHERE primary_taxonomy_code = $3)'
              : ''}
        ) r ON r.npi = t.npi
      `;

      const params = withinTaxonomy ? [npi, year, taxonomy] : [npi, year];
      const result = await db.query(query, params);
      const row = result.rows[0];
      if (!row) return null;

      const finalScore = num(row.final_score);
      // The target provider exists but has no score this year: rank and
      // percentile are undefined, with an explicit reason.
      if (finalScore === null) {
        return {
          npi,
          year,
          scope: withinTaxonomy ? 'taxonomy' : 'overall',
          taxonomy: withinTaxonomy ? taxonomy : null,
          finalScore: null,
          rank: null,
          totalCount: row.total_count === null ? 0 : Number(row.total_count),
          percentile: null,
          reason: 'Provider has no MIPS final score for this year'
        };
      }

      return {
        npi: row.npi,
        year,
        scope: withinTaxonomy ? 'taxonomy' : 'overall',
        taxonomy: withinTaxonomy ? taxonomy : null,
        finalScore,
        rank: Number(row.rank),
        totalCount: Number(row.total_count),
        percentile: num(row.percentile)
      };
    } catch (error) {
      logger.error('Error calculating provider ranking:', error);
      throw new Error('Failed to calculate provider ranking');
    }
  }

  /**
   * Per-year MIPS scores for a provider across a year range, plus trend
   * analysis (direction, total change, year-over-year deltas, best/worst).
   * The rolling-vintage warning applies only when a rolling (request-labeled)
   * row is involved; years bulk-loaded from archived per-year CMS vintages
   * (year_source = 'archive') are true measurements and carry no warning.
   */
  async getTrends(npi, startYear, endYear) {
    try {
      const query = `
        SELECT performance_year, final_score, quality_score,
               improvement_activities_score, promoting_interoperability_score,
               cost_score, year_source
        FROM mips_performance_scores
        WHERE npi = $1 AND performance_year BETWEEN $2 AND $3
        ORDER BY performance_year ASC
      `;

      const result = await db.query(query, [npi, startYear, endYear]);
      const years = result.rows.map(row => ({
        year: Number(row.performance_year),
        finalScore: num(row.final_score),
        qualityScore: num(row.quality_score),
        improvementActivitiesScore: num(row.improvement_activities_score),
        promotingInteroperabilityScore: num(row.promoting_interoperability_score),
        costScore: num(row.cost_score)
      }));

      const hasRollingVintage = result.rows.some(
        row => row.year_source !== 'archive'
      );

      return {
        npi,
        startYear,
        endYear,
        years,
        analysis: this.analyzeTrend(years),
        warning: hasRollingVintage
          ? 'performance_year values are request labels on a rolling CMS ' +
            'vintage, not distinct measurement years; year-over-year trends may ' +
            'reflect re-based scores rather than true performance change.'
          : null
      };
    } catch (error) {
      logger.error('Error in trend analysis:', error);
      throw new Error('Failed to generate performance trend analysis');
    }
  }

  analyzeTrend(years) {
    const scored = years.filter(y => y.finalScore !== null);
    if (scored.length === 0) return null;

    const first = scored[0];
    const last = scored[scored.length - 1];
    const totalChange = round2(last.finalScore - first.finalScore);

    let direction;
    if (totalChange > 5) direction = 'improving';
    else if (totalChange < -5) direction = 'declining';
    else direction = 'stable';

    const yearlyDeltas = [];
    for (let i = 1; i < scored.length; i++) {
      yearlyDeltas.push({
        fromYear: scored[i - 1].year,
        toYear: scored[i].year,
        change: round2(scored[i].finalScore - scored[i - 1].finalScore)
      });
    }

    const best = scored.reduce((a, b) => (b.finalScore > a.finalScore ? b : a));
    const worst = scored.reduce((a, b) => (b.finalScore < a.finalScore ? b : a));

    return {
      direction,
      totalChange,
      yearlyDeltas,
      bestYear: best.year,
      worstYear: worst.year
    };
  }

  /**
   * Percentile-over-time for one provider against their taxonomy cohort,
   * backed by the materialized taxonomy_percentiles table (built by
   * tools/build-taxonomy-percentiles.js). One row per archive year for the
   * provider's primary taxonomy.
   *
   * Taxonomy resolution uses the same coalesce order as the loader:
   * nppes_providers.primary_taxonomy_code first (national coverage),
   * providers.primary_taxonomy_code as fallback for npis missing from
   * nppes_providers. An npi with no taxonomy in either table yields
   * taxonomy=null and an explicit reason (controller maps this to 404).
   *
   * Percentile definition: share of scored same-taxonomy peers (archive
   * rows, final_score NOT NULL) scoring at or below the provider, 100 =
   * best; identical to getRanking. Computed at read time from
   * mips_performance_scores rather than interpolated from the stored
   * quartiles, because p25/p50/p75 + scored_count cannot reproduce the
   * exact at-or-below share; the stored quartiles supply the band.
   * Distribution columns (median/p25/p75/scored_count) come from
   * taxonomy_percentiles, and each row carries provenance (source, as_of).
   */
  async getPercentileTrends(npi) {
    try {
      const taxRes = await db.query(`
        SELECT COALESCE(n.primary_taxonomy_code, p.primary_taxonomy_code) AS taxonomy_code
        FROM (SELECT $1 AS npi) s
        LEFT JOIN nppes_providers n ON n.npi = s.npi
        LEFT JOIN providers p ON p.npi = s.npi
      `, [npi]);
      const taxonomy = taxRes.rows[0] && taxRes.rows[0].taxonomy_code
        ? String(taxRes.rows[0].taxonomy_code)
        : null;

      if (!taxonomy) {
        return {
          npi,
          taxonomy: null,
          years: [],
          reason: 'No primary taxonomy on record for this NPI in nppes_providers or providers'
        };
      }

      const tpRes = await db.query(`
        SELECT performance_year, scored_count, min_final_score, max_final_score,
               median_final_score, p25_final_score, p75_final_score, mean_final_score,
               source, as_of
        FROM taxonomy_percentiles
        WHERE taxonomy_code = $1
        ORDER BY performance_year ASC
      `, [taxonomy]);

      const years = [];
      for (const row of tpRes.rows) {
        const year = Number(row.performance_year);

        // Exact at-or-below share within the taxonomy cohort for this year.
        // Peers = npis whose resolved taxonomy (same coalesce order as the
        // loader) equals the provider's taxonomy.
        const pctRes = await db.query(`
          SELECT t.final_score AS provider_score,
                 COUNT(m.final_score) AS cohort_scored,
                 COUNT(*) FILTER (WHERE m.final_score <= t.final_score) AS at_or_below
          FROM (
            SELECT final_score FROM mips_performance_scores
            WHERE npi = $1 AND performance_year = $2 AND year_source = 'archive'
          ) t
          CROSS JOIN mips_performance_scores m
          WHERE m.performance_year = $2
            AND m.year_source = 'archive'
            AND m.final_score IS NOT NULL
            AND m.npi IN (
              SELECT n.npi FROM nppes_providers n WHERE n.primary_taxonomy_code = $3
              UNION
              SELECT p.npi FROM providers p
              WHERE p.primary_taxonomy_code = $3
                AND NOT EXISTS (SELECT 1 FROM nppes_providers n2 WHERE n2.npi = p.npi)
            )
          GROUP BY t.final_score
        `, [npi, year, taxonomy]);

        const pctRow = pctRes.rows[0];
        const finalScore = pctRow ? num(pctRow.provider_score) : null;
        let percentile = null;
        if (finalScore !== null && pctRow && Number(pctRow.cohort_scored) > 0) {
          percentile = Math.round(
            10000 * Number(pctRow.at_or_below) / Number(pctRow.cohort_scored)
          ) / 100;
        }

        years.push({
          performance_year: year,
          final_score: finalScore,
          percentile,
          median_final_score: round2(num(row.median_final_score)),
          p25: round2(num(row.p25_final_score)),
          p75: round2(num(row.p75_final_score)),
          scored_count: Number(row.scored_count),
          year_source: 'archive',
          provenance: {
            source: row.source,
            as_of: row.as_of === null || row.as_of === undefined
              ? null
              : (row.as_of instanceof Date ? row.as_of.toISOString().slice(0, 10) : String(row.as_of))
          }
        });
      }

      return { npi, taxonomy, years };
    } catch (error) {
      logger.error('Error in percentile trends:', error);
      throw new Error('Failed to generate percentile trend analysis');
    }
  }

  /**
   * Per-taxonomy benchmark report for one archive performance year
   * (Story 4.1). Distribution summary (min/max/mean/quartiles) comes from
   * the materialized taxonomy_percentiles row; the decile ladder and the
   * per-state breakdown are computed at read time with PERCENTILE_CONT
   * over scored archive mips rows whose resolved taxonomy
   * (COALESCE(nppes_providers.primary_taxonomy_code,
   * providers.primary_taxonomy_code), the same order the materializer
   * uses) matches. Returns null when the taxonomy-year is not
   * materialized (controller maps to 404); throws a 400 when the stored
   * cohort is too large for a live decile computation.
   */
  async getTaxonomyBenchmark(taxonomy, year) {
    try {
      const tpRes = await db.query(`
        SELECT scored_count, min_final_score, max_final_score,
               median_final_score, p25_final_score, p75_final_score,
               mean_final_score, source, as_of
        FROM taxonomy_percentiles
        WHERE taxonomy_code = $1 AND performance_year = $2
      `, [taxonomy, year]);
      const tpRow = tpRes.rows[0];
      if (!tpRow) return null;

      const scoredCount = Number(tpRow.scored_count);
      if (scoredCount > MAX_LIVE_COHORT) {
        throw Object.assign(
          new Error(
            `Cohort of ${scoredCount} scored providers is too large for a live ` +
            'decile computation; request a smaller taxonomy group'
          ),
          { statusCode: 400 }
        );
      }

      // One pass with GROUPING SETS: the empty set yields the cohort-wide
      // decile ladder, the state set yields the per-state breakdown, so
      // the cohort scan happens once instead of twice.
      const res = await db.query(`
        SELECT GROUPING(COALESCE(n.practice_state, p.practice_state)) AS overall,
               COALESCE(n.practice_state, p.practice_state) AS state,
               COUNT(m.final_score) AS scored_count,
               ${DECILE_SELECT},
               PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY m.final_score) AS median_final_score
        FROM mips_performance_scores m
        LEFT JOIN nppes_providers n ON n.npi = m.npi
        LEFT JOIN providers p ON p.npi = m.npi
        WHERE m.year_source = 'archive'
          AND m.final_score IS NOT NULL
          AND m.performance_year = $1
          AND COALESCE(n.primary_taxonomy_code, p.primary_taxonomy_code) = $2
        GROUP BY GROUPING SETS (
          (),
          (COALESCE(n.practice_state, p.practice_state))
        )
      `, [year, taxonomy]);

      const overallRow = res.rows.find(r => Number(r.overall) === 1) || {};
      const deciles = {};
      for (let i = 1; i <= 9; i++) {
        deciles[`d${i * 10}`] = round2(num(overallRow[`d${i * 10}`]));
      }

      return {
        taxonomy,
        performance_year: year,
        scoredCount,
        mean: round2(num(tpRow.mean_final_score)),
        deciles,
        quartiles: {
          p25: round2(num(tpRow.p25_final_score)),
          p50: round2(num(tpRow.median_final_score)),
          p75: round2(num(tpRow.p75_final_score))
        },
        min: num(tpRow.min_final_score),
        max: num(tpRow.max_final_score),
        states: res.rows
          .filter(r => Number(r.overall) === 0 && r.state !== null && r.state !== undefined)
          .sort((a, b) => Number(b.scored_count) - Number(a.scored_count))
          .map(r => ({
            state: String(r.state),
            scoredCount: Number(r.scored_count),
            median: round2(num(r.median_final_score))
          })),
        provenance: {
          source: tpRow.source,
          as_of: tpRow.as_of === null || tpRow.as_of === undefined
            ? null
            : (tpRow.as_of instanceof Date ? tpRow.as_of.toISOString().slice(0, 10) : String(tpRow.as_of))
        }
      };
    } catch (error) {
      if (error.statusCode) throw error;
      logger.error('Error in taxonomy benchmark:', error);
      throw new Error('Failed to generate taxonomy benchmark report');
    }
  }

  /**
   * Compare one provider's score to the national distribution for a year.
   * Returns null when the provider has no score that year.
   */
  async getBenchmark(npi, year) {
    try {
      const query = `
        SELECT t.final_score AS provider_score,
               AVG(m.final_score) AS national_average,
               MIN(m.final_score) AS min_score,
               MAX(m.final_score) AS max_score,
               PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY m.final_score) AS q1,
               PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY m.final_score) AS median,
               PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY m.final_score) AS q3,
               COUNT(m.final_score) AS peer_count
        FROM mips_performance_scores m
        CROSS JOIN (
          SELECT final_score FROM mips_performance_scores
          WHERE npi = $1 AND performance_year = $2
        ) t
        WHERE m.performance_year = $2
          AND m.final_score IS NOT NULL
        GROUP BY t.final_score
      `;

      const result = await db.query(query, [npi, year]);
      const row = result.rows[0];
      if (!row) return null;

      const providerScore = num(row.provider_score);
      const q1 = num(row.q1);
      const median = num(row.median);
      const q3 = num(row.q3);
      const nationalAverage = round2(num(row.national_average));

      // Unscored (or non-numeric) provider scores and quartiles cannot be
      // classified — return an explicit unscored status instead of defaulting
      // to the bottom quartile.
      if (providerScore === null || q1 === null || median === null || q3 === null ||
          nationalAverage === null) {
        return {
          npi,
          year,
          status: 'unscored',
          reason: 'Provider or peer scores are missing or non-numeric for this year',
          providerScore,
          peerCount: 0
        };
      }

      let quartile;
      let position;
      if (providerScore >= q3) { quartile = 4; position = 'top_25'; }
      else if (providerScore >= median) { quartile = 3; position = 'above_average'; }
      else if (providerScore >= q1) { quartile = 2; position = 'below_average'; }
      else { quartile = 1; position = 'bottom_25'; }

      return {
        npi,
        year,
        providerScore,
        nationalAverage,
        differenceFromNational: round2(providerScore - nationalAverage),
        quartiles: { q1: round2(q1), median: round2(median), q3: round2(q3) },
        quartile,
        position,
        peerCount: Number(row.peer_count),
        min: num(row.min_score),
        max: num(row.max_score)
      };
    } catch (error) {
      logger.error('Error in benchmark comparison:', error);
      throw new Error('Failed to generate benchmark comparison');
    }
  }
}

module.exports = AnalyticsService;
module.exports.computeDeciles = computeDeciles;
module.exports.DECILE_POINTS = DECILE_POINTS;
