#!/usr/bin/env node
/**
 * Data-quality audit over the screening tables (read-only).
 *
 * Reports, per NPI-carrying table: NPI format violations (not 10 digits),
 * null/empty NPIs, and duplicate NPIs; plus null-name counts where a name
 * exists, and taxonomy codes present in nppes_providers but absent from
 * taxonomy_codes (skipped if that table does not exist).
 *
 * Usage: node tools/data-quality-audit.js        (writes docs/data-quality-report.md)
 *        node tools/data-quality-audit.js --stdout
 */
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const db = require('../src/config/database');
const toStdout = process.argv.includes('--stdout');

const NPI_TABLES = [
  { table: 'nppes_providers', name: 'National NPPES load (V.2)', key: 'npi' },
  { table: 'national_screening', name: 'Materialized national screening', key: 'npi' },
  { table: 'providers', name: 'Legacy provider cache', key: 'npi' },
  { table: 'mips_performance_scores', name: 'MIPS score cache', key: 'npi, performance_year' },
  { table: 'oig_exclusions', name: 'OIG LEIE', key: 'npi' },
  { table: 'state_exclusions', name: 'State Medicaid exclusion lists', key: 'npi' }
];

async function npiAudit(table, key) {
  const r = await db.query(
    `SELECT count(*)::int AS total,
            count(npi)::int AS non_null,
            count(*) FILTER (WHERE npi IS NOT NULL AND btrim(npi) <> ''
                             AND npi !~ '^[0-9]{10}$')::int AS bad_format,
            count(*) FILTER (WHERE npi IS NULL OR btrim(npi) = '')::int AS empty,
            (SELECT count(*)::int FROM (
               SELECT ${key} FROM ${table}
               WHERE npi IS NOT NULL AND btrim(npi) <> ''
               GROUP BY ${key} HAVING count(*) > 1) d) AS dup_keys
       FROM ${table}`
  );
  return r.rows[0];
}

async function nullNames(table, expr, label) {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${expr} IS NULL OR btrim(${expr}) = ''`
  );
  return { label, count: r.rows[0].n };
}

(async () => {
  const lines = [];
  const emit = s => { lines.push(s); if (toStdout) console.log(s); };
  const date = new Date().toISOString().slice(0, 10);
  emit(`# Data quality report — ${date}`);
  emit('');
  emit('Read-only audit over NPI-carrying tables. Registries legitimately');
  emit('contain empty NPIs (older exclusions predate NPI issuance); those are');
  emit('reported as facts, not automatically as defects.');
  emit('');
  emit('## NPI format audit');
  emit('');
  emit('Duplicate keys = keys (NPI, or NPI+year for the MIPS cache) with more');
  emit('than one row; registry tables legitimately hold multiple records per NPI.');
  emit('');
  emit('| Table | Rows | Null/empty NPI | Bad format (not 10 digits) | Duplicate keys |');
  emit('| --- | ---: | ---: | ---: | ---: |');

  for (const { table, name, key } of NPI_TABLES) {
    const a = await npiAudit(table, key);
    emit(`| ${name} (\`${table}\`) | ${a.total} | ${a.empty} | ${a.bad_format} | ${a.dup_keys} |`);
  }

  emit('');
  emit('## Null-name counts');
  emit('');
  emit('| Table | Field | Null/empty |');
  emit('| --- | --- | ---: |');
  const nameChecks = [
    ['nppes_providers', `CASE WHEN entity_type_code = '2' THEN legal_business_name
       ELSE concat_ws(' ', first_name, last_name) END`, 'display name (org LBN, else first+last)'],
    ['national_screening', 'entity_name', 'entity_name'],
    ['providers', `COALESCE(name_full, concat_ws(' ', name_first, name_last))`, 'name_full fallback'],
    ['oig_exclusions', `COALESCE(display_name, busname, concat_ws(' ', firstname, lastname))`, 'display name'],
    ['state_exclusions', 'entity_name', 'entity_name']
  ];
  for (const [table, expr, label] of nameChecks) {
    const r = await nullNames(table, expr, label);
    emit(`| \`${table}\` | ${r.label} | ${r.count} |`);
  }

  const taxTable = await db.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='taxonomy_codes'");
  emit('');
  if (taxTable.rows.length) {
    const r = await db.query(
      `SELECT count(DISTINCT p.primary_taxonomy_code)::int AS n
         FROM nppes_providers p
        WHERE p.primary_taxonomy_code IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM taxonomy_codes t WHERE t.code = p.primary_taxonomy_code)`);
    emit('## Taxonomy codes absent from taxonomy_codes');
    emit('');
    emit(`Distinct primary taxonomy codes in nppes_providers with no taxonomy_codes row: ${r.rows[0].n}`);
  } else {
    emit('## Taxonomy code reference check');
    emit('');
    emit('Skipped: no `taxonomy_codes` reference table exists in this database.');
  }

  if (!toStdout) {
    const out = path.join(__dirname, '..', 'docs', 'data-quality-report.md');
    fs.writeFileSync(out, lines.join('\n') + '\n');
    console.log(`wrote ${out}`);
  }
  await db.pool.end();
})().catch(error => {
  console.error('data-quality-audit failed:', error.message);
  process.exit(1);
});
