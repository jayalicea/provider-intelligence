#!/usr/bin/env node
/**
 * Overnight build of national_screening (Phase 1).
 *
 * Populates the materialized screening table from nppes_providers in batches
 * of 500,000 rows (keyset pagination on npi, one INSERT..SELECT per batch —
 * no single giant transaction), then self-verifies the row total against
 * nppes_providers and reports per-verdict counts.
 *
 * Usage: node tools/overnight-national-screening.js [--batch-size N] [--verify-only]
 */
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const db = require('../src/config/database');
const { logger } = require('../src/utils/logger');

const BATCH = (() => {
  const i = process.argv.indexOf('--batch-size');
  return i > -1 ? Number(process.argv[i + 1]) : 500000;
})();
const VERIFY_ONLY = process.argv.includes('--verify-only');

const INSERT_BATCH = `
  INSERT INTO national_screening (
    npi, entity_name, entity_type, practice_state, practice_city,
    primary_taxonomy_code,
    leie_verdict, leie_detail, state_verdict, state_detail,
    mips_available, final_score, computed_at
  )
  SELECT
    p.npi,
    CASE WHEN p.entity_type_code = '2'
         THEN p.legal_business_name
         ELSE btrim(concat_ws(' ', p.first_name, p.middle_name, p.last_name))
    END AS entity_name,
    CASE WHEN p.entity_type_code = '2' THEN 'Organization' ELSE 'Individual' END,
    p.practice_state,
    p.practice_city,
    p.primary_taxonomy_code,
    CASE
      WHEN leie.npi IS NULL THEN 'CLEAR'
      WHEN leie.reindate IS NULL OR btrim(leie.reindate) IN ('', '00000000')
        THEN 'EXCLUDED'
      ELSE 'REINSTATED'
    END AS leie_verdict,
    CASE WHEN leie.npi IS NULL THEN NULL ELSE to_jsonb(leie) END AS leie_detail,
    CASE
      WHEN se.npi IS NULL THEN 'CLEAR'
      WHEN se.reinstatement_date IS NULL THEN 'EXCLUDED'
      ELSE 'REINSTATED'
    END AS state_verdict,
    CASE WHEN se.npi IS NULL THEN NULL ELSE to_jsonb(se) END AS state_detail,
    m.npi IS NOT NULL AS mips_available,
    m.final_score,
    CURRENT_DATE
  FROM nppes_providers p
  LEFT JOIN (
    SELECT DISTINCT ON (o.npi) o.*
      FROM oig_exclusions o
     ORDER BY o.npi, (o.reindate IS NULL OR btrim(o.reindate) IN ('', '00000000')) DESC, o.excldate DESC
  ) leie ON leie.npi = p.npi
  LEFT JOIN (
    SELECT DISTINCT ON (s.npi) s.*
      FROM state_exclusions s
     ORDER BY s.npi, (s.reinstatement_date IS NULL) DESC, s.exclusion_date DESC NULLS LAST
  ) se ON se.npi = p.npi
  LEFT JOIN (
    SELECT DISTINCT ON (ms.npi) ms.npi, ms.final_score
      FROM mips_performance_scores ms
     ORDER BY ms.npi, ms.performance_year DESC
  ) m ON m.npi = p.npi
  WHERE p.npi > $1
  ORDER BY p.npi
  LIMIT $2
  ON CONFLICT (npi) DO NOTHING
`;

async function verify() {
  const [total, screening, byLeie, byState, byMips] = await Promise.all([
    db.query('SELECT count(*)::int AS n FROM nppes_providers'),
    db.query('SELECT count(*)::int AS n FROM national_screening'),
    db.query(`SELECT leie_verdict, count(*)::int AS n FROM national_screening GROUP BY leie_verdict ORDER BY 1`),
    db.query(`SELECT state_verdict, count(*)::int AS n FROM national_screening GROUP BY state_verdict ORDER BY 1`),
    db.query(`SELECT count(*)::int AS n FROM national_screening WHERE mips_available`)
  ]);
  const report = {
    nppes_total: total.rows[0].n,
    screening_total: screening.rows[0].n,
    match: Number(total.rows[0].n) === Number(screening.rows[0].n),
    leie_verdicts: Object.fromEntries(byLeie.rows.map(r => [r.leie_verdict, r.n])),
    state_verdicts: Object.fromEntries(byState.rows.map(r => [r.state_verdict, r.n])),
    mips_available: byMips.rows[0].n
  };
  logger.info(`verify: ${JSON.stringify(report)}`);
  return report;
}

(async () => {
  if (VERIFY_ONLY) {
    await verify();
    await db.pool.end();
    return;
  }

  const started = Date.now();
  let lastNpi = '';
  let inserted = 0;

  for (;;) {
    const t0 = Date.now();
    const result = await db.query(INSERT_BATCH, [lastNpi, BATCH]);
    const n = result.rowCount;
    inserted += n;
    if (n > 0) {
      const max = await db.query(
        'SELECT max(npi) AS npi FROM national_screening WHERE npi > $1', [lastNpi]);
      lastNpi = max.rows[0].npi;
    }
    logger.info(`batch: inserted ${n} rows (total ${inserted}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (n < BATCH) break;
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  logger.info(`populate complete: ${inserted} rows in ${seconds}s`);

  const report = await verify();
  if (!report.match) {
    logger.error('SELF-VERIFY FAILED: national_screening total does not match nppes_providers');
    process.exitCode = 1;
  }
  await db.pool.end();
})().catch(error => {
  logger.error('overnight-national-screening failed:', error);
  process.exit(1);
});
