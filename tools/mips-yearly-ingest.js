#!/usr/bin/env node
// MIPS yearly archive ingest, Phase A0: bulk-load true per-performance-year
// MIPS rows from the archived "Clinician Public Reporting: Overall MIPS
// Performance" CSV vintages (docs/research/mips-yearly-sources.md).
//
// CMS publishes a single dataset (a174-a962) and re-bases it in place each
// year, so older vintages are Wayback Machine captures of the per-vintage
// content-hash CSV resource paths; PY 2024 is the current live file.
// Sources verified 2026-09-18 (metastore snapshot titles + downloads).
//
// Idempotent: upserts keyed by the table's UNIQUE (npi, performance_year),
// so re-runs replace the archive rows for the requested year. Self-verifies
// parsed = inserted = table count for the year (HOUSE style; exits non-zero
// on mismatch).
//
// Usage:
//   node tools/mips-yearly-ingest.js [--year 2018] [--dry-run]
//   (no --year: every year listed in YEARS with a local CSV)

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', 'data', 'mips-yearly');

// CSV resource paths (docs/research/mips-yearly-sources.md) and where each
// local copy came from; row counts measured at download on 2026-09-18.
const YEARS = {
  2018: { file: 'mips_2018.csv', origin: 'wayback 20210420015959 of ..._1611967946' },
  2019: { file: 'mips_2019.csv', origin: 'wayback 20210715043153 of ..._1622837122' },
  2020: { file: 'mips_2020.csv', origin: 'wayback 20220309182606 of ..._1645646732' },
  2022: { file: 'mips_2022.csv', origin: 'wayback 20250909221456 of ..._1721952317' },
  2023: { file: 'mips_2023.csv', origin: 'wayback 20260304043619 of ..._1763510763' },
  2024: { file: 'mips_2024.csv', origin: 'live ..._1787091345 (verified 2026-09-18)' }
};
// PY 2021 (file ..._1697774725) has no Wayback capture and is 404 live;
// PY 2017 was never on the provider-data catalog. Both: insufficient
// materials, deliberately not listed.

// --- normalization -----------------------------------------------------------

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Scores arrive as strings; empty, 'N/A', and other footnote codes -> null.
const num = v => {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Header names vary by vintage; match case-insensitively on a flattened key
// (spaces and underscores dropped) so position never matters.
const hkey = s => String(s).toLowerCase().replace(/[\s_]+/g, '');

const HEADER_MAP = {
  npi: 'npi',
  orgpacid: 'org_pac_id',
  lstnm: 'last_name',
  frstnm: 'first_name',
  providerlastname: 'last_name',
  providerfirstname: 'first_name',
  source: 'source',
  qualitycategoryscore: 'quality_score',
  picategoryscore: 'promoting_interoperability_score',
  iacategoryscore: 'improvement_activities_score',
  costcategoryscore: 'cost_score',
  finalmipsscore: 'final_score'
};

// Quote-aware single-line CSV splitter. Names occasionally contain commas
// and quotes (thousands of lines per file), so a plain split is not safe.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Lazily join physical lines until quotes balance, so quoted fields with
// embedded newlines still parse (readline splits on newlines).
function makeRecordStream(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  let pending = null;
  const unbalanced = s => {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s[i] === '"') n++;
    return n % 2 === 1;
  };
  return {
    async * records() {
      for await (let line of rl) {
        if (pending !== null) line = pending + '\n' + line;
        if (unbalanced(line)) { pending = line; continue; }
        pending = null;
        yield line;
      }
      if (pending !== null) yield pending;
    }
  };
}

function parseYear(filePath, year) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const seen = new Set();
    let duplicates = 0;
    let headerIdx = null;
    let dataLines = 0;
    let badNpis = 0;
    (async () => {
      try {
        for await (const line of makeRecordStream(filePath).records()) {
          if (headerIdx === null) {
            headerIdx = splitCsvLine(line).map(hkey);
            continue;
          }
          dataLines += 1;
          const cols = splitCsvLine(line);
          const row = {};
          for (let i = 0; i < headerIdx.length; i++) {
            const field = HEADER_MAP[headerIdx[i]];
            if (field) row[field] = cols[i];
          }
          const npi = clean(row.npi);
          // Rows without a usable 10-digit NPI cannot be keyed; skip them.
          if (!npi || !/^\d{10}$/.test(npi)) { badNpis += 1; continue; }
          // CMS publishes one row per (clinician, org affiliation), so NPIs
          // repeat; the table key is (npi, performance_year), so keep the
          // first occurrence and count the rest as duplicates.
          if (seen.has(npi)) { duplicates += 1; continue; }
          seen.add(npi);
          rows.push({
            npi,
            performance_year: year,
            final_score: num(row.final_score),
            overall_category_score: null,
            quality_score: num(row.quality_score),
            improvement_activities_score: num(row.improvement_activities_score),
            promoting_interoperability_score: num(row.promoting_interoperability_score),
            cost_score: num(row.cost_score)
          });
        }
        resolve({ rows, dataLines, badNpis, duplicates });
      } catch (e) { reject(e); }
    })();
  });
}

// --- database ----------------------------------------------------------------

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

const UPSERT_SQL = `
  INSERT INTO mips_performance_scores (
    npi, performance_year, final_score, overall_category_score,
    quality_score, improvement_activities_score,
    promoting_interoperability_score, cost_score, year_source
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'archive')
  ON CONFLICT (npi, performance_year) DO UPDATE SET
    final_score = EXCLUDED.final_score,
    overall_category_score = EXCLUDED.overall_category_score,
    quality_score = EXCLUDED.quality_score,
    improvement_activities_score = EXCLUDED.improvement_activities_score,
    promoting_interoperability_score = EXCLUDED.promoting_interoperability_score,
    cost_score = EXCLUDED.cost_score,
    year_source = EXCLUDED.year_source,
    sync_timestamp = CURRENT_TIMESTAMP`;

async function runYear(year, { dryRun, client }) {
  const src = YEARS[year];
  const filePath = path.join(DATA_DIR, src.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing CSV for PY ${year}: ${filePath}`);
  }

  console.log(`parsing PY ${year}: ${src.file} (${src.origin})`);
  const { rows, dataLines, badNpis, duplicates } = await parseYear(filePath, year);
  console.log(`PY ${year}: data_lines=${dataLines} parsed=${rows.length} duplicate_npis=${duplicates} skipped_no_npi=${badNpis}`);

  if (dryRun) return { year, parsed: rows.length, inserted: 0 };

  // Idempotent re-run: this year's archive rows are replaced wholesale, then
  // re-inserted in one transaction, so partial failures roll back cleanly.
  await client.query('BEGIN');
  try {
    await client.query(
      "DELETE FROM mips_performance_scores WHERE performance_year = $1 AND year_source = 'archive'",
      [year]
    );
    for (const r of rows) {
      await client.query(UPSERT_SQL, [
        r.npi, r.performance_year, r.final_score, r.overall_category_score,
        r.quality_score, r.improvement_activities_score,
        r.promoting_interoperability_score, r.cost_score
      ]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }

  const table = parseInt(
    (await client.query(
      "SELECT count(*) AS n FROM mips_performance_scores WHERE performance_year = $1 AND year_source = 'archive'",
      [year]
    )).rows[0].n,
    10
  );
  if (table !== rows.length) {
    console.error(`MIPS_YEARLY_FAILED year=${year} parsed=${rows.length} inserted=${rows.length} table=${table}`);
    process.exit(1);
  }
  console.log(`MIPS_YEARLY_OK year=${year} parsed=${rows.length} inserted=${rows.length} table=${table}`);
  return { year, parsed: rows.length, inserted: rows.length };
}

// --- cli ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { year: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--year') args.year = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (args.year !== null && !YEARS[args.year]) {
    console.error(`--year must be one of ${Object.keys(YEARS).join(', ')} (got ${args.year})`);
    process.exit(1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const years = args.year !== null ? [args.year] : Object.keys(YEARS).map(Number);

  let client = null;
  if (!args.dryRun) {
    const { Client } = require('pg');
    const env = readEnvFile();
    client = new Client({
      host: env.DB_HOST || process.env.DB_HOST || 'localhost',
      port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
      database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
      user: env.DB_USER || process.env.DB_USER || 'admin',
      password: env.DB_PASSWORD || process.env.DB_PASSWORD || ''
    });
    await client.connect();
  }

  try {
    const results = [];
    for (const year of years) {
      results.push(await runYear(year, { dryRun: args.dryRun, client }));
    }
    const total = results.reduce((a, r) => a + r.parsed, 0);
    console.log(`MIPS_YEARLY_DONE years=${years.join(',')} total_parsed=${total} dry_run=${args.dryRun}`);
  } finally {
    if (client) await client.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('MIPS_YEARLY_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseYear, splitCsvLine, parseArgs, YEARS, UPSERT_SQL };
