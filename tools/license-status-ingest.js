#!/usr/bin/env node
// License status ingest, Phase 1: Texas Medical Board + Colorado DORA
// Socrata bulk feeds (free, keyless; verified live 2026-09-17, see
// docs/research/license-source-survey.md). Normalizes both feeds into the
// shared license_status shape and TRUNCATE + reloads the table, self-verifying
// parsed vs inserted vs table counts (HOUSE style; exits non-zero on any
// mismatch).
//
// Live column names verified by direct fetch 2026-09-18:
//   TX tm3v-pfq9: license_type, first_name, last_name, year_of_birth,
//     license_number, license_issue_date, license_expiration_date,
//     registration_status, registration_status_date, disciplinary_status,
//     license_status, degree, practice_address/city/state/zip,
//     currently_licensed
//   CO 7s5z-vewr: lastname, firstname, middlename, city, state, mailzipcode,
//     licensetype, licensenumber, licensefirstissuedate,
//     licenselastreneweddate, licenseexpirationdate,
//     licensestatusdescription, linktoverifylicense, ...
//
// Usage:
//   node tools/license-status-ingest.js [--source tx|co|all] [--dry-run]

const https = require('https');

const PAGE_SIZE = 1000; // Socrata caps unauthenticated pages at 1000 rows
const CONCURRENCY = 4;  // modest parallel page fetches, polite to the hosts
const BATCH_PAUSE_MS = 150;

const SOURCES = {
  tx: {
    state: 'TX',
    label: 'Texas Medical Board',
    url: 'https://data.texas.gov/resource/tm3v-pfq9.json'
  },
  co: {
    state: 'CO',
    label: 'Colorado DORA',
    url: 'https://data.colorado.gov/resource/7s5z-vewr.json'
  }
};

// --- normalization -----------------------------------------------------------

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Socrata date-times arrive as ISO strings; keep the date part.
const dateOnly = v => {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

// Texas Medical Board row -> common shape. The board's registration_status is
// the lifecycle value (Active/Terminated/...); license_status carries a
// secondary code, surfaced as the disciplinary-adjacent detail.
function normalizeTxRow(row, asOf) {
  const licenseNumber = clean(row.license_number);
  if (!licenseNumber) return null;
  return {
    license_number: licenseNumber,
    issuing_state: 'TX',
    license_type: clean(row.license_type),
    status: clean(row.registration_status),
    status_date: dateOnly(row.registration_status_date),
    expiration_date: dateOnly(row.license_expiration_date),
    disciplinary_status: clean(row.disciplinary_status),
    raw_name: [clean(row.first_name), clean(row.last_name)]
      .filter(Boolean).join(' ') || null,
    source: 'Texas Medical Board (data.texas.gov tm3v-pfq9)',
    as_of: asOf
  };
}

// Colorado DORA row -> common shape. No separate status date is published;
// last-renewed date is the closest dated event.
function normalizeCoRow(row, asOf) {
  const licenseNumber = clean(row.licensenumber);
  if (!licenseNumber) return null;
  return {
    license_number: licenseNumber,
    issuing_state: 'CO',
    license_type: clean(row.licensetype),
    status: clean(row.licensestatusdescription),
    status_date: dateOnly(row.licenselastreneweddate),
    expiration_date: dateOnly(row.licenseexpirationdate),
    disciplinary_status: null,
    raw_name: [clean(row.firstname), clean(row.lastname)]
      .filter(Boolean).join(' ') || null,
    source: 'Colorado DORA (data.colorado.gov 7s5z-vewr)',
    as_of: asOf
  };
}

const NORMALIZERS = { tx: normalizeTxRow, co: normalizeCoRow };

// --- fetching ----------------------------------------------------------------

function fetchUrl(url, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        // Browser-like UA; bare client UAs are blocked by some Socrata fronts.
        'User-Agent': 'Mozilla/5.0 (compatible; provider-intelligence license-status-ingest)',
        Accept: 'application/json'
      }
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fetch every page of one Socrata endpoint. Pages short of PAGE_SIZE end the
// walk early; the final full page is re-fetched once to confirm it is the end
// (a full last page returns 0 rows on the probe).
async function fetchSocrataRows(url, fetcher = fetchUrl) {
  const page = async offset =>
    JSON.parse(await fetcher(`${url}?$limit=${PAGE_SIZE}&$offset=${offset}`));

  const out = [];
  let offset = 0;
  for (;;) {
    const offsets = [];
    for (let i = 0; i < CONCURRENCY; i++) offsets.push(offset + i * PAGE_SIZE);
    const pages = await Promise.all(offsets.map(o => page(o).catch(e => ({ __error: e.message }))));
    let sawShort = false;
    let failed = null;
    for (const rows of pages) {
      if (rows.__error) { failed = rows.__error; break; }
      out.push(...rows);
      if (rows.length < PAGE_SIZE) sawShort = true;
    }
    if (failed) throw new Error(`page fetch failed at offset ${offset}: ${failed}`);
    offset += CONCURRENCY * PAGE_SIZE;
    if (sawShort || pages.every(p => p.length === 0)) break;
    await sleep(BATCH_PAUSE_MS);
  }
  return out;
}

// --- database ----------------------------------------------------------------

function readEnvFile() {
  const fs = require('fs');
  const env = {};
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env / defaults */ }
  return env;
}

const INSERT_SQL = `
  INSERT INTO license_status (
    license_number, issuing_state, license_type, status, status_date,
    expiration_date, disciplinary_status, raw_name, source, as_of
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (issuing_state, license_number, COALESCE(license_type, ''))
    DO NOTHING`;

function dedupeKey(r) {
  return `${r.issuing_state}|${r.license_number}|${r.license_type || ''}`;
}

async function runSource(key, { dryRun, fetcher, client }) {
  const src = SOURCES[key];
  const asOf = new Date().toISOString().slice(0, 10);
  const normalize = NORMALIZERS[key];

  console.log(`fetching ${src.label}: ${src.url}`);
  const raw = await fetchSocrataRows(src.url, fetcher);
  const parsed = raw.map(r => normalize(r, asOf)).filter(Boolean);

  // Deduplicate on the table's unique key so parsed == inserted is checkable.
  const seen = new Set();
  const rows = [];
  let duplicates = 0;
  for (const r of parsed) {
    const k = dedupeKey(r);
    if (seen.has(k)) { duplicates += 1; continue; }
    seen.add(k);
    rows.push(r);
  }
  console.log(`${key}: fetched=${raw.length} parsed=${parsed.length} unique=${rows.length} duplicate_keys=${duplicates}`);

  if (dryRun) return { key, fetched: raw.length, parsed: parsed.length, inserted: 0, duplicates };

  await client.query('DELETE FROM license_status WHERE issuing_state = $1', [src.state]);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    for (const r of batch) {
      await client.query(INSERT_SQL, [
        r.license_number, r.issuing_state, r.license_type, r.status,
        r.status_date, r.expiration_date, r.disciplinary_status,
        r.raw_name, r.source, r.as_of
      ]);
      inserted += 1;
    }
    if (i % 20000 === 0 && i > 0) console.log(`  ${key}: inserted ${inserted}/${rows.length}`);
  }

  const table = parseInt(
    (await client.query('SELECT count(*) AS n FROM license_status WHERE issuing_state = $1', [src.state])).rows[0].n,
    10
  );
  if (inserted !== rows.length || table !== inserted) {
    console.error(`LICENSE_STATUS_FAILED ${key} parsed=${parsed.length} unique=${rows.length} inserted=${inserted} table=${table}`);
    process.exit(1);
  }
  console.log(`LICENSE_STATUS_OK ${key} parsed=${parsed.length} inserted=${inserted} table=${table} as_of=${asOf}`);
  return { key, fetched: raw.length, parsed: parsed.length, inserted, duplicates };
}

// --- cli ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { source: 'all', dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = String(argv[++i]).toLowerCase();
    else if (a === '--dry-run') args.dryRun = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (!['all', 'tx', 'co'].includes(args.source)) {
    console.error(`--source must be all, tx or co (got ${args.source})`);
    process.exit(1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const keys = args.source === 'all' ? ['tx', 'co'] : [args.source];

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
    for (const key of keys) {
      results.push(await runSource(key, { dryRun: args.dryRun, fetcher: fetchUrl, client }));
    }
    const total = results.reduce((a, r) => a + r.parsed, 0);
    console.log(`LICENSE_STATUS_DONE sources=${keys.join(',')} total_parsed=${total} dry_run=${args.dryRun}`);
  } finally {
    if (client) await client.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('LICENSE_STATUS_FAILED:', e.message); process.exit(1); });
}

module.exports = {
  normalizeTxRow, normalizeCoRow, fetchSocrataRows, parseArgs,
  SOURCES, PAGE_SIZE, INSERT_SQL
};
