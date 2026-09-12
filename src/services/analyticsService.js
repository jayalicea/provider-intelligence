const db = require('../config/database');
const { logger } = require('../utils/logger');

// phynpi.md §6 specifies these analytics; its SQL is not executable as
// printed ($0 placeholders, a nonexistent status_count column), so the
// queries below implement the same intent with valid PostgreSQL.
const num = v => (v === null || v === undefined ? null : Number(v));
const round2 = v => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

class AnalyticsService {

  /**
   * Aggregate performance statistics for a group of providers in one year.
   * npis: array of 10-digit NPI strings.
   */
  async getGroupPerformance(npis, year) {
    try {
      const query = `
        SELECT
          COUNT(*) AS provider_count,
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
      const query = `
        SELECT npi, final_score, rank, total_count, percentile
        FROM (
          SELECT m.npi, m.final_score,
            RANK() OVER (ORDER BY m.final_score DESC) AS rank,
            COUNT(*) OVER () AS total_count,
            ROUND(100.0 * COUNT(*) FILTER (WHERE m.final_score <= t.final_score) OVER ()
                  / COUNT(*) OVER (), 2) AS percentile
          FROM mips_performance_scores m
          CROSS JOIN (
            SELECT final_score FROM mips_performance_scores
            WHERE npi = $1 AND performance_year = $2
          ) t
          WHERE m.performance_year = $2
            ${withinTaxonomy
              ? 'AND m.npi IN (SELECT npi FROM providers WHERE primary_taxonomy_code = $3)'
              : ''}
        ) ranked
        WHERE npi = $1
      `;

      const params = withinTaxonomy ? [npi, year, taxonomy] : [npi, year];
      const result = await db.query(query, params);
      const row = result.rows[0];
      if (!row) return null;

      return {
        npi: row.npi,
        year,
        scope: withinTaxonomy ? 'taxonomy' : 'overall',
        taxonomy: withinTaxonomy ? taxonomy : null,
        finalScore: num(row.final_score),
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
   */
  async getTrends(npi, startYear, endYear) {
    try {
      const query = `
        SELECT performance_year, final_score, quality_score,
               improvement_activities_score, promoting_interoperability_score,
               cost_score
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

      return {
        npi,
        startYear,
        endYear,
        years,
        analysis: this.analyzeTrend(years)
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
               COUNT(*) AS peer_count
        FROM mips_performance_scores m
        CROSS JOIN (
          SELECT final_score FROM mips_performance_scores
          WHERE npi = $1 AND performance_year = $2
        ) t
        WHERE m.performance_year = $2
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
