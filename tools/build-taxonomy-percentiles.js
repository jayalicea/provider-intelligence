#!/usr/bin/env node
// Materializes per-taxonomy-per-year MIPS final-score distribution
// aggregates into taxonomy_percentiles (see
// src/config/migrations/20260919_taxonomy_percentiles.sql). TRUNCATE +
// rebuild, so rerunning is idempotent.
//
// Taxonomy join: mips_performance_scores carries npi only. Primary join
// source is nppes_providers.primary_taxonomy_code (9.7M national rows);
// providers.primary_taxonomy_code (local cache) is the fallback for npis
// missing from nppes_providers. Equivalent to
// COALESCE(nppes.primary_taxonomy_code, providers.primary_taxonomy_code).
//
// Self-verifying: scored archive rows accounted for = aggregated (matched)
// + unmatched (no taxonomy in either table). If matched + unmatched does
// not equal the source row count, the job exits non-zero and leaves the
// rebuilt table in place for inspection.
//
// Percentile definition (matches analyticsService.getGroupPerformance /
// getBenchmark): PERCENTILE_CONT linear interpolation over non-null
// final_score rows only. Only year_source='archive' rows participate.
//
// Usage: node tools/build-taxonomy-percentiles.js [--dry-run]

const fs = require('fs');

function readEnvFile() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env / defaults */ }
  return env;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else { console.error(`Unknown argument: ${argv[i]}`); process.exit(1); }
  }
  return args;
}

const AGGREGATE_SQL = `
  SELECT
    COALESCE(n.primary_taxonomy_code, p.primary_taxonomy_code) AS taxonomy_code,
    m.performance_year,
    COUNT(m.final_score) AS scored_count,
    MIN(m.final_score) AS min_final_score,
    MAX(m.final_score) AS max_final_score,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY m.final_score) AS median_final_score,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY m.final_score) AS p25_final_score,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY m.final_score) AS p75_final_score,
    AVG(m.final_score) AS mean_final_score
  FROM mips_performance_scores m
  LEFT JOIN nppes_providers n ON n.npi = m.npi
  LEFT JOIN providers p ON p.npi = m.npi
  WHERE m.year_source = 'archive'
    AND m.final_score IS NOT NULL
  GROUP BY 1, 2
  ORDER BY 1, 2
`;

const SOURCE_COUNT_SQL = `
  SELECT COUNT(*) AS source_count
  FROM mips_performance_scores
  WHERE year_source = 'archive' AND final_score IS NOT NULL
`;

// Unmatched = resolved taxonomy is NULL: npi absent from both tables, or
// present but with NULL primary_taxonomy_code in both (the LEFT JOIN would
// coalesce to NULL). Scalar subqueries are safe because npi is unique in
// both tables.
const UNMATCHED_SQL = `
  SELECT COUNT(*) AS unmatched_count
  FROM mips_performance_scores m
  WHERE m.year_source = 'archive'
    AND m.final_score IS NOT NULL
    AND COALESCE(
      (SELECT n.primary_taxonomy_code FROM nppes_providers n WHERE n.npi = m.npi),
      (SELECT p.primary_taxonomy_code FROM providers p WHERE p.npi = m.npi)
    ) IS NULL
`;

const INSERT_SQL = `
  INSERT INTO taxonomy_percentiles
    (taxonomy_code, performance_year, scored_count, min_final_score,
     max_final_score, median_final_score, p25_final_score, p75_final_score,
     mean_final_score, source, as_of)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'mips_performance_scores', CURRENT_DATE)
  ON CONFLICT (taxonomy_code, performance_year) DO UPDATE SET
    scored_count = EXCLUDED.scored_count,
    min_final_score = EXCLUDED.min_final_score,
    max_final_score = EXCLUDED.max_final_score,
    median_final_score = EXCLUDED.median_final_score,
    p25_final_score = EXCLUDED.p25_final_score,
    p75_final_score = EXCLUDED.p75_final_score,
    mean_final_score = EXCLUDED.mean_final_score,
    source = EXCLUDED.source,
    as_of = EXCLUDED.as_of
`;

function percentileCont(sorted, p) {
  if (!sorted.length) return null;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Pure form of AGGREGATE_SQL, kept in sync with the SQL above and unit
// tested against a fixture (tests/taxonomy-percentiles.test.js). mipsRows:
// { npi, performance_year, final_score } candidate rows (archive, scored).
// resolveTaxonomy: npi -> taxonomy code or null, implementing the loader's
// COALESCE(nppes, providers) order. Returns { groups, matched, unmatched }.
function computeAggregates(mipsRows, resolveTaxonomy) {
  const byKey = new Map();
  let matched = 0;
  let unmatched = 0;
  for (const row of mipsRows) {
    const score = Number(row.final_score);
    if (row.final_score === null || row.final_score === undefined || !Number.isFinite(score)) {
      continue;
    }
    const taxonomy = resolveTaxonomy(String(row.npi));
    if (taxonomy === null || taxonomy === undefined) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    const key = `${taxonomy}:${row.performance_year}`;
    if (!byKey.has(key)) byKey.set(key, { taxonomy_code: taxonomy, performance_year: Number(row.performance_year), scores: [] });
    byKey.get(key).scores.push(score);
  }
  const groups = [...byKey.values()].map(g => {
    const scores = g.scores.sort((a, b) => a - b);
    return {
      taxonomy_code: g.taxonomy_code,
      performance_year: g.performance_year,
      scored_count: scores.length,
      min_final_score: scores[0],
      max_final_score: scores[scores.length - 1],
      median_final_score: percentileCont(scores, 0.5),
      p25_final_score: percentileCont(scores, 0.25),
      p75_final_score: percentileCont(scores, 0.75),
      mean_final_score: scores.reduce((a, b) => a + b, 0) / scores.length
    };
  });
  return { groups, matched, unmatched };
}

async function main() {
  const args = parseArgs(process.argv);
  const { Client } = require('pg');
  const env = readEnvFile();
  const c = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || '',
  });
  await c.connect();

  try {
    const sourceRes = await c.query(SOURCE_COUNT_SQL);
    const sourceCount = Number(sourceRes.rows[0].source_count);

    const unmatchedRes = await c.query(UNMATCHED_SQL);
    const unmatchedCount = Number(unmatchedRes.rows[0].unmatched_count);

    const aggRes = await c.query(AGGREGATE_SQL);
    const matched = aggRes.rows.filter(r => r.taxonomy_code !== null && r.taxonomy_code !== undefined);
    const matchedScored = matched.reduce((a, r) => a + Number(r.scored_count), 0);

    const perYear = {};
    for (const r of matched) {
      const y = Number(r.performance_year);
      perYear[y] = (perYear[y] || 0) + Number(r.scored_count);
    }
    console.log(`source scored archive rows: ${sourceCount}`);
    console.log(`aggregated (taxonomy matched) rows: ${matchedScored} across ${matched.length} taxonomy-year groups`);
    for (const y of Object.keys(perYear).sort()) {
      console.log(`  ${y}: ${perYear[y]} scored rows`);
    }
    console.log(`unmatched scored rows (no resolvable primary taxonomy): ${unmatchedCount}`);

    if (matchedScored + unmatchedCount !== sourceCount) {
      console.error(`TAXONOMY_PERCENTILES_FAILED accounting mismatch: matched=${matchedScored} unmatched=${unmatchedCount} source=${sourceCount}`);
      process.exit(1);
    }

    if (args.dryRun) {
      console.log(`TAXONOMY_PERCENTILES_DRY_RUN ok; would insert ${matched.length} taxonomy_percentiles rows`);
      return;
    }

    await c.query('TRUNCATE taxonomy_percentiles');
    for (const r of matched) {
      await c.query(INSERT_SQL, [
        String(r.taxonomy_code), Number(r.performance_year), Number(r.scored_count),
        r.min_final_score, r.max_final_score, r.median_final_score,
        r.p25_final_score, r.p75_final_score, r.mean_final_score
      ]);
    }

    const verifyRes = await c.query('SELECT COUNT(*) AS n, COALESCE(SUM(scored_count), 0) AS scored FROM taxonomy_percentiles');
    const tableRows = Number(verifyRes.rows[0].n);
    const tableScored = Number(verifyRes.rows[0].scored);
    if (tableRows !== matched.length || tableScored !== matchedScored) {
      console.error(`TAXONOMY_PERCENTILES_FAILED verify mismatch: inserted=${matched.length}/${matchedScored} table=${tableRows}/${tableScored}`);
      process.exit(1);
    }

    console.log(`TAXONOMY_PERCENTILES_OK source=${sourceCount} matched=${matchedScored} unmatched=${unmatchedCount} table_rows=${tableRows} table_scored=${tableScored}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('TAXONOMY_PERCENTILES_FAILED:', e.message); process.exit(1); });
}

module.exports = { computeAggregates };
