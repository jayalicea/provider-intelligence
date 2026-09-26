#!/usr/bin/env node
// Ingest a CMS POS iQIES quarterly CSV (Home Health + ASC + Hospice, one
// file) into `facilities`. Modeled on tools/clia-ingest.js - same
// architecture (stream -> temp table -> set-based merge) with the iQIES
// column map: lowercase headers, ISO dates, and "Not Available" sentinels.
//
// Usage: node tools/facility-ingest.js [path-to-csv] [--dry-run]
//        (default: tmp/iqies-q1-2026.csv)

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const DEFAULT_FILE = 'tmp/iqies-q1-2026.csv';
const BATCH = 1500; // 1500 x 17 params = 25,500 < 65,535 cap

// iQIES header -> staging column. Dates arrive ISO; "Not Available" -> null.
const COLS = {
  prvdr_num: 'ccn',
  fac_name: 'facility_name',
  prvdr_type_id: 'provider_type_id',
  prvdr_sbtyp_id: 'provider_subtype',
  st_adr: 'address',
  city_name: 'city',
  state_cd: 'state',
  zip_cd: 'zip',
  phne_num: 'phone',
  crtfctn_dt: 'certification_dt',
  trmntn_exprtn_dt: 'termination_dt',
  cmplnc_stus_cd: 'compliance_status',
  acrdtn_type_cd: 'accreditation_type_cd',
  orgnl_prtcptn_dt: 'original_participation_dt'
};
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const args = { file: DEFAULT_FILE, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--')) { console.error(`Unknown argument: ${a}`); process.exit(1); }
    else args.file = a;
  }
  return args;
}

// Quote-aware CSV split (same as clia-ingest).
function splitCsv(line) {
  const out = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

const clean = v => (v === undefined || v === '' || v === 'Not Available' ? null : v);

function vintageDate(asOf) {
  const m = asOf.match(/Q(\d)_(\d{4})/);
  if (!m) return null;
  const monthDay = { 1: '01-02', 2: '04-01', 3: '07-02', 4: '10-02' }[m[1]];
  return monthDay ? `${m[2]}-${monthDay}` : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const asOf = path.basename(args.file, '.csv');
  const vintage = vintageDate(asOf);

  const { Client } = require('pg');
  const env = readEnvFile();
  const client = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || '',
  });
  await client.connect();

  let header = null;
  let idx = null;
  let parsed = 0;
  let batch = [];
  const stats = { inserted: 0, updated: 0, retired: 0 };

  const PARAMS_PER_ROW = Object.keys(COLS).length + 3; // cols + data_source + first_seen + last_confirmed

  function rowToParams(rec) {
    const get = col => clean(rec[idx[col]]);
    const params = Object.keys(COLS).map(col => {
      const v = get(col);
      return COLS[col].endsWith('_dt') && ISO_DATE_RE.test(v || '') ? v : v;
    });
    params.push(asOf, vintage, vintage);
    return params;
  }

  async function flushBatch() {
    if (batch.length === 0) return;
    const placeholders = [];
    const values = [];
    for (let r = 0; r < batch.length; r++) {
      const base = r * PARAMS_PER_ROW;
      placeholders.push(`(${Array.from({ length: PARAMS_PER_ROW }, (_, i) => `$${base + i + 1}`).join(',')})`);
      values.push(...batch[r]);
    }
    await client.query(
      `INSERT INTO tmp_facility_stage (
         ccn, facility_name, provider_type_id, provider_subtype, address, city,
         state, zip, phone, certification_dt, termination_dt, compliance_status,
         accreditation_type_cd, original_participation_dt,
         data_source, first_seen_at, last_confirmed_at
       ) VALUES ${placeholders.join(',')}`,
      values
    );
    batch = [];
  }

  if (!args.dryRun) {
    await client.query('CREATE TEMP TABLE tmp_facility_stage (LIKE facilities INCLUDING DEFAULTS)');
  }

  // Create the readline interface AFTER the DB setup: lines emitted before
  // the for-await consumer attaches are lost (lesson from clia-ingest).
  const rl = readline.createInterface({
    input: fs.createReadStream(args.file),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = splitCsv(line).map(h => h.trim());
      idx = Object.fromEntries(header.map((h, i) => [h, i]));
      const missing = Object.keys(COLS).filter(col => idx[col] === undefined);
      if (missing.length) console.warn(`warn: columns not in header: ${missing.join(', ')}`);
      continue;
    }
    const rec = splitCsv(line);
    const ccn = clean(rec[idx.prvdr_num]);
    if (!ccn) continue;
    batch.push(rowToParams(rec));
    parsed++;
    if (!args.dryRun && batch.length >= BATCH) {
      await flushBatch();
      if (parsed % 20000 === 0) console.log(`  staged ${parsed}`);
    } else if (args.dryRun && parsed <= 2) {
      console.log('sample:', JSON.stringify(batch[batch.length - 1]).slice(0, 300));
    }
  }

  if (args.dryRun) {
    console.log(`DRY_RUN parsed=${parsed}`);
    await client.end();
    return;
  }

  await flushBatch();
  console.log(`staged ${parsed} facilities; merging...`);

  await client.query('BEGIN');
  try {
    const upd = await client.query(
      `UPDATE facilities f
          SET facility_name = s.facility_name, provider_type_id = s.provider_type_id,
              provider_subtype = s.provider_subtype, address = s.address, city = s.city,
              state = s.state, zip = s.zip, phone = s.phone,
              certification_dt = s.certification_dt, termination_dt = s.termination_dt,
              compliance_status = s.compliance_status,
              accreditation_type_cd = s.accreditation_type_cd,
              original_participation_dt = s.original_participation_dt,
              data_source = s.data_source, last_confirmed_at = s.last_confirmed_at,
              currently_registered = true, sync_timestamp = CURRENT_TIMESTAMP
         FROM tmp_facility_stage s WHERE f.ccn = s.ccn`
    );
    const ins = await client.query(
      `INSERT INTO facilities (
         ccn, facility_name, provider_type_id, provider_subtype, address, city,
         state, zip, phone, certification_dt, termination_dt, compliance_status,
         accreditation_type_cd, original_participation_dt,
         data_source, first_seen_at, last_confirmed_at, currently_registered
       )
       SELECT s.ccn, s.facility_name, s.provider_type_id, s.provider_subtype, s.address, s.city,
              s.state, s.zip, s.phone, s.certification_dt, s.termination_dt, s.compliance_status,
              s.accreditation_type_cd, s.original_participation_dt,
              s.data_source, s.first_seen_at, s.last_confirmed_at, true
         FROM tmp_facility_stage s
         LEFT JOIN facilities f ON f.ccn = s.ccn
        WHERE f.ccn IS NULL`
    );
    // Guard: with an empty stage or first load, retire is a no-op - and a
    // failed parse must never unlist the whole table.
    const existing = await client.query('SELECT COUNT(*)::int AS n FROM facilities');
    if (parsed > 0 && existing.rows[0].n > 0) {
      const ret = await client.query(
        `UPDATE facilities f SET currently_registered = false
          WHERE f.currently_registered
            AND NOT EXISTS (SELECT 1 FROM tmp_facility_stage s WHERE s.ccn = f.ccn)`
      );
      stats.retired = ret.rowCount;
    } else {
      console.warn(`warn: retire-absent skipped (staged=${parsed}, existing=${existing.rows[0].n})`);
    }
    stats.inserted = ins.rowCount;
    stats.updated = upd.rowCount;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }

  console.log(`FACILITY_INGEST_OK source=${asOf} staged=${parsed} inserted=${stats.inserted} updated=${stats.updated} retired=${stats.retired}`);
}

if (require.main === module) {
  main().catch(e => { console.error('FACILITY_INGEST_FAILED:', e.message); process.exit(1); });
}

module.exports = { splitCsv };
