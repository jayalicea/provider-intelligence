#!/usr/bin/env node
// One-off migration for the quality_measures cache table.
//
// Before the refresh in cmsDataService became atomic, cacheQualityMeasures
// deleted a facility/family's rows and then issued single-row inserts outside
// any transaction. Two concurrent refreshes of the same facility could
// interleave as DELETE-A, DELETE-B, INSERT-A, INSERT-B and leave both row sets
// behind. Nothing at the database level prevented it: the table carried only a
// non-unique index on facility_id.
//
// This script removes the surviving duplicates and adds the unique index that
// makes the condition unrepresentable. It is idempotent -- a second run finds
// nothing to delete and leaves the existing index alone.
//
// Duplicates are resolved on (facility_id, measure_id, data_source), the key
// the index enforces, keeping the newest sync_timestamp and breaking ties on
// the lowest id. Rows sharing (facility_id, measure_id) under *different*
// data_source values are distinct measure families, not duplicates; they are
// reported but never deleted.
//
// Usage: node tools/quality-measures-dedup.js [--dry-run]

const fs = require('fs');

const INDEX_NAME = 'idx_quality_facility_measure_source';

const COUNTS_SQL = `
  SELECT
    (SELECT count(*) FROM quality_measures) AS total_rows,
    (SELECT count(*) FROM (
       SELECT DISTINCT facility_id, measure_id, data_source FROM quality_measures
     ) d) AS distinct_keys,
    (SELECT count(*) FROM (
       SELECT DISTINCT facility_id, measure_id FROM quality_measures
     ) d) AS distinct_pairs,
    (SELECT count(DISTINCT facility_id) FROM quality_measures) AS facilities`;

// Keep the newest row per key; delete the rest.
const DEDUP_SQL = `
  DELETE FROM quality_measures q
  USING (
    SELECT id,
           row_number() OVER (
             PARTITION BY facility_id, measure_id, data_source
             ORDER BY sync_timestamp DESC NULLS LAST, id ASC
           ) AS rn
    FROM quality_measures
  ) ranked
  WHERE q.id = ranked.id AND ranked.rn > 1`;

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

function readEnvFile() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env / defaults below */ }
  return env;
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
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || ''
  });

  await c.connect();
  try {
    const before = (await c.query(COUNTS_SQL)).rows[0];
    const total = parseInt(before.total_rows, 10);
    const keys = parseInt(before.distinct_keys, 10);
    const pairs = parseInt(before.distinct_pairs, 10);
    console.log(`before: rows=${total} distinct_keys=${keys} distinct_pairs=${pairs} facilities=${before.facilities}`);
    console.log(`duplicates to remove: ${total - keys}`);

    // A gap here means one measure_id appears under two data_source values.
    // Legitimate (one row per measure family), so flag it rather than delete.
    if (keys !== pairs) {
      console.log(`note: ${keys - pairs} measure(s) appear under more than one data_source; kept as distinct families`);
    }

    if (args.dryRun) {
      console.log('DEDUP_DRY_RUN no changes written');
      return;
    }

    await c.query('BEGIN');
    const deleted = (await c.query(DEDUP_SQL)).rowCount;
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME}
                   ON quality_measures(facility_id, measure_id, data_source)`);
    await c.query('COMMIT');
    console.log(`deleted ${deleted} duplicate row(s); unique index ${INDEX_NAME} in place`);

    const after = (await c.query(COUNTS_SQL)).rows[0];
    const afterTotal = parseInt(after.total_rows, 10);
    const afterKeys = parseInt(after.distinct_keys, 10);
    console.log(`after: rows=${afterTotal} distinct_keys=${afterKeys} facilities=${after.facilities}`);

    if (afterTotal !== afterKeys || afterTotal !== keys || deleted !== total - keys) {
      console.error(`DEDUP_FAILED rows=${afterTotal} distinct_keys=${afterKeys} expected=${keys} deleted=${deleted}`);
      process.exit(1);
    }
    console.log(`DEDUP_OK rows=${afterTotal} distinct_keys=${afterKeys} deleted=${deleted}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('DEDUP_FAILED:', e.message); process.exit(1); });
}

module.exports = { COUNTS_SQL, DEDUP_SQL, INDEX_NAME, parseArgs };
