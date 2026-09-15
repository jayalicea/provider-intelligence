#!/usr/bin/env node
/**
 * National screening headline numbers (audit facts, no marketing language).
 * Prints to console and is the source for docs/national-headlines.md.
 *
 * Usage: node tools/national-headlines.js [--json]
 */
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const db = require('../src/config/database');
const json = process.argv.includes('--json');

(async () => {
  const [total, leie, stateOnly, both, mips, types, reinstat] = await Promise.all([
    db.query('SELECT count(*)::int AS n FROM national_screening'),
    db.query(`SELECT count(*)::int AS n FROM national_screening WHERE leie_verdict = 'EXCLUDED'`),
    db.query(`SELECT count(*)::int AS n FROM national_screening
               WHERE state_verdict = 'EXCLUDED' AND leie_verdict <> 'EXCLUDED'`),
    db.query(`SELECT count(*)::int AS n FROM national_screening
               WHERE state_verdict = 'EXCLUDED' AND leie_verdict = 'EXCLUDED'`),
    db.query('SELECT count(*)::int AS n FROM national_screening WHERE mips_available'),
    db.query(`SELECT entity_type, count(*)::int AS n FROM national_screening GROUP BY entity_type ORDER BY 1`),
    db.query(`SELECT count(*)::int AS n FROM national_screening
               WHERE leie_verdict = 'REINSTATED' OR state_verdict = 'REINSTATED'`)
  ]);

  const report = {
    totalNpiScreened: total.rows[0].n,
    leieActiveExclusions: leie.rows[0].n,
    stateListOnlyHits: stateOnly.rows[0].n,
    bothRegistryHits: both.rows[0].n,
    reinstatementRecords: reinstat.rows[0].n,
    mipsScoredProviders: mips.rows[0].n,
    entityTypes: Object.fromEntries(types.rows.map(r => [r.entity_type, r.n]))
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('National screening headlines (national_screening, computed_at:',
      `${new Date().toISOString().slice(0, 10)})`);
    console.log(`  Total NPIs screened:            ${report.totalNpiScreened.toLocaleString('en-US')}`);
    console.log(`  Active LEIE exclusions found:   ${report.leieActiveExclusions.toLocaleString('en-US')}`);
    console.log(`  State-list-only hits:           ${report.stateListOnlyHits.toLocaleString('en-US')}`);
    console.log(`  Both-registry hits:             ${report.bothRegistryHits.toLocaleString('en-US')}`);
    console.log(`  Reinstatement records:          ${report.reinstatementRecords.toLocaleString('en-US')}`);
    console.log(`  MIPS-scored providers:          ${report.mipsScoredProviders.toLocaleString('en-US')}`);
    for (const [type, n] of Object.entries(report.entityTypes)) {
      console.log(`  ${type + 's:'}`.padEnd(34) + n.toLocaleString('en-US'));
    }
  }
  await db.pool.end();
})().catch(error => {
  console.error('national-headlines failed:', error.message);
  process.exit(1);
});
