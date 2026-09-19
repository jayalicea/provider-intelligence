-- Per-taxonomy-per-year distribution aggregates over MIPS final scores,
-- materialized by tools/build-taxonomy-percentiles.js (TRUNCATE + rebuild,
-- idempotent). Feeds the percentile-trends read path
-- (GET /api/v1/analytics/percentile-trends/:npi) behind Stories 5.1 and 4.1.
--
-- Percentile semantics match src/services/analyticsService.js exactly:
-- aggregates are computed with PERCENTILE_CONT (linear interpolation) over
-- non-null final_score rows only (Postgres ordered-set aggregates ignore
-- NULL inputs), the same definition used by getGroupPerformance and
-- getBenchmark. Only archive vintages participate (year_source='archive');
-- rolling-vintage rows carry a request label, not a measurement year.
-- The per-provider percentile in percentile-trends uses the getRanking
-- definition instead (share of scored peers scoring at or below the
-- provider, 100 = best), computed at read time.

CREATE TABLE IF NOT EXISTS taxonomy_percentiles (
  taxonomy_code      VARCHAR(10) NOT NULL,
  performance_year   INT         NOT NULL,
  scored_count       INT         NOT NULL,
  min_final_score    NUMERIC,
  max_final_score    NUMERIC,
  median_final_score NUMERIC,
  p25_final_score    NUMERIC,
  p75_final_score    NUMERIC,
  mean_final_score   NUMERIC,
  source             TEXT        NOT NULL DEFAULT 'mips_performance_scores',
  as_of              DATE        NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (taxonomy_code, performance_year)
);
