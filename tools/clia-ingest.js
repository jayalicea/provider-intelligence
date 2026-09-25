#!/usr/bin/env node
// Ingest a CMS Provider of Services Clinical Laboratories (CLIA) quarterly
// CSV into clia_labs. Streams the (very large) file line by line, stages
// batches into a temp table, then merges in three set-based statements -
// one full upsert pass, no per-row round trips. Quarterly re-ingests UPDATE
// survivors (last_confirmed_at), INSERT newcomers (first_seen_at), and mark
// CLIA numbers absent from the new vintage currently_registered=false.
//
// Usage: node tools/clia-ingest.js [path-to-csv] [--dry-run]
//        (default: tmp/clia-q2-2026.csv)

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const DEFAULT_FILE = 'tmp/clia-q2-2026.csv';
const SOURCE_NAME = 'CMS POS Clinical Laboratories (CLIA)';
const BATCH = 5000;

// Header column -> staging column. Dates arrive as YYYYMMDD strings.
const COLS = {
  PRVDR_NUM: 'clia_number',
  FAC_NAME: 'lab_name',
  ADDTNL_FAC_NAME: 'additional_lab_name',
  ST_ADR: 'address',
  CITY_NAME: 'city',
  STATE_CD: 'state',
  ZIP_CD: 'zip',
  PHNE_NUM: 'phone',
  FAX_PHNE_NUM: 'fax',
  CRTFCT_TYPE_CD: 'certificate_type_cd',
  CRTFCT_EFCTV_DT: 'certificate_effective_dt',
  CRTFCTN_DT: 'certification_dt',
  CMPLNC_STUS_CD: 'compliance_status_cd',
  PGM_TRMNTN_CD: 'termination_cd',
  TRMNTN_EXPRTN_DT: 'termination_dt',
  CLIA_TRMNTN_CD: 'clia_termination_cd',
  CURRENT_CLIA_LAB_CLSFCTN_CD: 'lab_classification_cd',
  CLIA_MDCR_NUM: 'medicare_number',
  ORGNL_PRTCPTN_DT: 'original_participation_dt',
  GNRL_CNTL_TYPE_CD: 'ownership_type_cd'
};
const CLASSIFICATION_COLS = Array.from({ length: 10 }, (_, i) => `CLIA_LAB_CLASSIFICATION_CD_${i + 1}`);
const ACCRED_COLS = ['A2LA', 'AABB', 'AOA', 'ASHI', 'CAP', 'COLA', 'JCAHO'];

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

// Quote-aware single CSV record split (file is not RFC-formatted in
// practice, but FAC_NAME can carry quoted commas).
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

const toDate = v => (/^\d{8}$/.test(v || '') ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);
const clean = v => (v === undefined || v === '' ? null : v);

// Catalog vintage dates: Q1->01-02, Q2->04-01, Q3->07-02, Q4->10-02
// (matches the CMS publication dates in the data.gov catalog).
function vintageDate(asOf) {
  const m = asOf.match(/Q(\d)_(\d{4})/);
  if (!m) return null;
  const monthDay = { 1: '01-02', 2: '04-01', 3: '07-02', 4: '10-02' }[m[1]];
  return monthDay ? `${m[2]}-${monthDay}` : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const asOf = path.basename(args.file, '.csv'); // e.g. Clia_DATA.Q2_2026
  const vintage = vintageDate(asOf);
  const rl = readline.createInterface({
    input: fs.createReadStream(args.file),
    crlfDelay: Infinity
  });

  let header = null;
  let idx = null;
  let parsed = 0;
  let batch = [];
  let stats = { inserted: 0, updated: 0, retired: 0 };

  const { Client } = require('pg');
  const env = readEnvFile();
  const c = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || '',
  });

  function rowToParams(rec) {
    const get = col => clean(rec[idx[col]]);
    const params = Object.keys(COLS).map(col => {
      const v = get(col);
      return COLS[col].endsWith('_dt') ? toDate(v) : v;
    });
    const classes = CLASSIFICATION_COLS.map(col => clean(rec[idx[col]])).filter(v => v && v !== '00');
    const accred = {};
    for (const body of ACCRED_COLS) {
      const flag = get(`${body}_ACRDTD_CD`);
      if (flag === 'Y') {
        accred[body] = { matchDate: toDate(get(`${body}_ACRDTD_Y_MATCH_DT`)) || null };
      }
    }
    params.push(classes, JSON.stringify(accred), asOf, vintage);
    return params;
  }

  async function flushBatch(client) {
    if (batch.length === 0) return;
    const placeholders = [];
    const values = [];
    for (let r = 0; r < batch.length; r++) {
      const base = r * 25;
      placeholders.push(`(${Array.from({ length: 25 }, (_, i) => `$${base + i + 1}`).join(',')})`);
      values.push(...batch[r]);
    }
    await client.query(
      `INSERT INTO tmp_clia_stage (
         clia_number, lab_name, additional_lab_name, address, city, state, zip,
         phone, fax, certificate_type_cd, certificate_effective_dt, certification_dt,
         compliance_status_cd, termination_cd, termination_dt, clia_termination_cd,
         lab_classification_cd, medicare_number, original_participation_dt,
         ownership_type_cd, lab_classification_cds, accreditation, data_source, first_seen_at, last_confirmed_at
       ) VALUES ${placeholders.join(',')}`,
      values
    );
    stats.inserted += batch.length;
    batch = [];
  }

  let client = null;
  if (!args.dryRun) {
    client = new Client({
      host: env.DB_HOST || 'localhost',
      port: parseInt(env.DB_PORT || '5432', 10),
      database: env.DB_NAME || 'provider_intelligence',
      user: env.DB_USER || 'admin',
      password: env.DB_PASSWORD || '',
    });
    await client.connect();
    await client.query(`CREATE TEMP TABLE tmp_clia_stage (LIKE clia_labs INCLUDING DEFAULTS) ON COMMIT DROP`);
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = splitCsv(line);
      idx = Object.fromEntries(header.map((h, i) => [h, i]));
      const missing = Object.keys(COLS).filter(col => idx[col] === undefined);
      if (missing.length) console.warn(`warn: columns not in header: ${missing.join(', ')}`);
      continue;
    }
    const rec = splitCsv(line);
    const clia = clean(rec[idx.PRVDR_NUM]);
    if (!clia) continue;
    batch.push(rowToParams(rec));
    parsed++;
    if (!args.dryRun && batch.length >= BATCH) {
      await flushBatch(client);
      if (parsed % 50000 === 0) console.log(`  staged ${parsed}`);
    } else if (args.dryRun && parsed <= 3) {
      console.log('sample:', JSON.stringify(batch[batch.length - 1]).slice(0, 400));
    }
  }

  if (args.dryRun) {
    console.log(`DRY_RUN parsed=${parsed}`);
    return;
  }

  await flushBatch(client);
  console.log(`staged ${parsed} labs; merging...`);

  await client.query('BEGIN');
  try {
    const upd = await client.query(
      `UPDATE clia_labs l
          SET lab_name = s.lab_name, additional_lab_name = s.additional_lab_name,
              address = s.address, city = s.city, state = s.state, zip = s.zip,
              phone = s.phone, fax = s.fax, certificate_type_cd = s.certificate_type_cd,
              certificate_effective_dt = s.certificate_effective_dt,
              certification_dt = s.certification_dt, compliance_status_cd = s.compliance_status_cd,
              termination_cd = s.termination_cd, termination_dt = s.termination_dt,
              clia_termination_cd = s.clia_termination_cd,
              lab_classification_cd = s.lab_classification_cd,
              lab_classification_cds = s.lab_classification_cds,
              medicare_number = s.medicare_number,
              original_participation_dt = s.original_participation_dt,
              ownership_type_cd = s.ownership_type_cd, accreditation = s.accreditation,
              data_source = s.data_source, last_confirmed_at = s.last_confirmed_at,
              currently_registered = true, sync_timestamp = CURRENT_TIMESTAMP
         FROM tmp_clia_stage s WHERE l.clia_number = s.clia_number`
    );
    const ins = await client.query(
      `INSERT INTO clia_labs (
         clia_number, lab_name, additional_lab_name, address, city, state, zip,
         phone, fax, certificate_type_cd, certificate_effective_dt, certification_dt,
         compliance_status_cd, termination_cd, termination_dt, clia_termination_cd,
         lab_classification_cd, lab_classification_cds, medicare_number,
         original_participation_dt, ownership_type_cd, accreditation,
         first_seen_at, last_confirmed_at, currently_registered, data_source
       )
       SELECT s.clia_number, s.lab_name, s.additional_lab_name, s.address, s.city, s.state, s.zip,
              s.phone, s.fax, s.certificate_type_cd, s.certificate_effective_dt, s.certification_dt,
              s.compliance_status_cd, s.termination_cd, s.termination_dt, s.clia_termination_cd,
              s.lab_classification_cd, s.lab_classification_cds, s.medicare_number,
              s.original_participation_dt, s.ownership_type_cd, s.accreditation,
              s.first_seen_at, s.last_confirmed_at, true, s.data_source
         FROM tmp_clia_stage s
         LEFT JOIN clia_labs l ON l.clia_number = s.clia_number
        WHERE l.clia_number IS NULL`
    );
    const ret = await client.query(
      `UPDATE clia_labs SET currently_registered = false
        WHERE currently_registered AND clia_number NOT IN (SELECT clia_number FROM tmp_clia_stage)`
    );
    stats = { inserted: ins.rowCount, updated: upd.rowCount, retired: ret.rowCount };
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }

  console.log(`CLIA_INGEST_OK source=${asOf} staged=${parsed} inserted=${stats.inserted} updated=${stats.updated} retired=${stats.retired}`);
}

if (require.main === module) {
  main().catch(e => { console.error('CLIA_INGEST_FAILED:', e.message); process.exit(1); });
}

module.exports = { splitCsv, toDate };
