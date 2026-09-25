#!/usr/bin/env node
// Ingest the Pennsylvania DOH "Approved Practitioners" PDF text
// (tmp/pa-practitioners.txt, via pdftotext -layout) into
// cannabis_certifications. Like AL, the source publishes no license number,
// so rows are keyed by name; the parse carries city/state/ZIP (present in
// this source, unlike WV) for the NPPES match/resolver city+zip signals.
// Upsert-by-name preserves matched NPIs across refreshes and retires names
// absent from a new edition (currently_listed=false), same as AL.
//
// Usage: node tools/cannabis-ingest-pa.js [path-to-file] [--dry-run]
//        (default path: tmp/pa-practitioners.txt)

const fs = require('fs');

const DEFAULT_FILE = 'tmp/pa-practitioners.txt';
const STATE = 'PA';
const PROGRAM_NAME = 'Pennsylvania Medical Marijuana Program';
const SOURCE_NAME = 'PA DOH Approved Practitioners';
const SOURCE_URL = 'https://www.pa.gov/content/dam/copapwp-pagov/en/health/documents/topics/documents/programs/medical-marijuana/DOH%20Approved%20Practitioners.pdf';
const RETRIEVAL_METHOD = 'PDF parse';
// The source publishes physicians approved to certify patients; presence on
// the list is the published approval.
const CERTIFICATION_STATUS = 'approved';

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
};

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

// "as of August 31, 2026" -> "2026-08-31"; null when unparseable.
function parseAsOf(text) {
  const m = text.match(/as of ([A-Za-z]+) (\d{1,2}), (\d{4})/i);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${mo}-${String(m[2]).padStart(2, '0')}`;
}

// The PDF is a whitespace-columned table (its header repeats per page).
// Lines starting at column 0 carry the county in the first segment;
// indented lines are continuations or county-less entries. Columns are
// separated by 2+ spaces, so split on that rather than fixed offsets.
const CITYStateZip_RE = /([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z]{2})\s+(\d{5})/;
const PRACT_RE = /^([A-Za-z][A-Za-z .''-]{2,60}?),\s*((?:M\.?D\.?|D\.?O\.?)(?:,\s*PhD)?)\b/;
const HEADER_RE = /^County\s+Practitioner\s+Location/;

function splitName(raw) {
  // PA prints first-name-first ("Nora Sudarsan").
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Parse the whole list text. Returns { asOf, rows, stats }.
function parsePaList(text) {
  const lines = text.split(/\r?\n/);
  const asOf = parseAsOf(lines.slice(0, 12).join(' '));

  // The table begins at the first column-header row; everything earlier is
  // cover text and the dotted TOC.
  const startIdx = lines.findIndex(l => HEADER_RE.test(l.trim()));
  if (startIdx === -1) throw new Error('column header row not found');

  const rows = [];
  const rowsByKey = new Map();
  const stats = { entries: 0, noCity: 0, duplicateNames: 0, counties: new Set() };
  const seenNames = new Set();

  let county = '';
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const { first, last } = splitName(cur.name);
    if (!last) { cur = null; return; }
    const key = `${last}|${first}`;
    if (seenNames.has(key)) {
      // Same name listed again (multi-location listing, or a genuine
      // same-name pair the license-less source cannot distinguish). Keep
      // the first row; backfill location only.
      stats.duplicateNames++;
      const existing = rowsByKey.get(key);
      if (existing && !existing.city && cur.city) {
        existing.city = cur.city;
        existing.state = cur.state;
        existing.zip = cur.zip;
      }
      cur = null;
      return;
    }
    seenNames.add(key);
    const prov = [`PA DOH list as of ${asOf || 'undated'}`];
    if (cur.county) prov.push(`county: ${cur.county}`);
    if (cur.specialty) prov.push(`specialty: ${cur.specialty}`);
    const row = {
      first, last,
      credential: cur.credential,
      city: cur.city || '',
      state: cur.state || '',
      zip: cur.zip || '',
      county: cur.county || '',
      specialty: cur.specialty || '',
      provenance: prov.join('; ')
    };
    rows.push(row);
    rowsByKey.set(key, row);
    stats.entries++;
    if (!cur.city) stats.noCity++;
    if (cur.county) stats.counties.add(cur.county);
    cur = null;
  };

  for (const raw of lines.slice(startIdx + 1)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (HEADER_RE.test(line.trim()) || /Back to Top/.test(line)) continue;

    const segments = line.trim().split(/\s{2,}/).filter(s => s !== 'Specialty');
    // A column-0 segment is the county ONLY when it isn't itself an entry:
    // pdftotext trims the empty county column, so county-less entries also
    // start at column 0.
    const firstIsEntry = PRACT_RE.test(segments[0] || '');
    if (!firstIsEntry && !/^\s/.test(line)) {
      county = segments[0];
      flush();
      segments.shift();
    }

    const nameCred = (segments[0] || '').match(PRACT_RE);
    if (nameCred) {
      flush();
      cur = {
        name: nameCred[1].trim(),
        credential: nameCred[2].replace(/\./g, '').toUpperCase(),
        city: '', state: '', zip: '', county, specialty: ''
      };
      absorbLocation(cur, segments[1]);
      if (segments[2] && !cur.specialty) cur.specialty = segments[2].trim();
    } else if (cur) {
      absorbLocation(cur, segments[0]);
      if (segments[1] && !cur.specialty) cur.specialty = segments[1].trim();
    }
  }
  flush();

  return { asOf, rows, stats: { ...stats, counties: stats.counties.size } };
}

function absorbLocation(cur, text) {
  if (!text) return;
  const m = text.match(CITYStateZip_RE);
  if (m && !cur.city) {
    cur.city = m[1].trim().toUpperCase();
    cur.state = m[2].toUpperCase();
    cur.zip = m[3];
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const text = fs.readFileSync(args.file, 'utf8');
  const { asOf, rows, stats } = parsePaList(text);

  console.log(`source as_of: ${asOf}`);
  console.log(`parsed practitioners: ${rows.length} (without parsed city: ${stats.noCity}, counties: ${stats.counties}, duplicate names: ${stats.duplicateNames})`);

  if (args.dryRun) {
    for (const r of rows.slice(0, 3)) {
      console.log(`sample: ${r.last}, ${r.first} (${r.credential}) | ${r.city || '(no city)'} ${r.state} ${r.zip} | ${r.county} | ${r.specialty || '(no specialty)'}`);
    }
    console.log(`CANNABIS_INGEST_PA_DRY_RUN rows=${rows.length}`);
    return;
  }

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
    const lastArr = rows.map(r => r.last);
    const firstArr = rows.map(r => r.first);
    await c.query('BEGIN');
    const seen = await c.query(
      `UPDATE cannabis_certifications
          SET last_confirmed_at = $3::date, as_of = $3, currently_listed = true
        WHERE state = $1 AND source_name = $2
          AND (practitioner_last_name, practitioner_first_name) IN
              (SELECT * FROM unnest($4::text[], $5::text[]))
        RETURNING practitioner_last_name, practitioner_first_name`,
      [STATE, SOURCE_NAME, asOf, lastArr, firstArr]
    );
    const seenKeys = new Set(seen.rows.map(r => `${r.practitioner_last_name}|${r.practitioner_first_name}`));
    let inserted = 0;
    for (const r of rows) {
      if (seenKeys.has(`${r.last}|${r.first}`)) continue;
      await c.query(
        `INSERT INTO cannabis_certifications (
           state, source_name, source_url,
           practitioner_first_name, practitioner_last_name, credential, npi,
           license_number, certification_status, program_name, as_of,
           retrieval_method, provenance_note,
           first_listed_at, last_confirmed_at, currently_listed
         ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, $10, $11, $9::date, $9::date, true)`,
        [
          STATE, SOURCE_NAME, SOURCE_URL,
          r.first, r.last, r.credential,
          CERTIFICATION_STATUS, PROGRAM_NAME, asOf,
          RETRIEVAL_METHOD, r.provenance
        ]
      );
      inserted++;
    }
    const retired = await c.query(
      `UPDATE cannabis_certifications SET currently_listed = false
        WHERE state = $1 AND source_name = $2 AND currently_listed
          AND (practitioner_last_name, practitioner_first_name) NOT IN
              (SELECT * FROM unnest($3::text[], $4::text[]))`,
      [STATE, SOURCE_NAME, lastArr, firstArr]
    );
    await c.query('COMMIT');
    console.log(`CANNABIS_INGEST_PA_OK confirmed=${seen.rows.length} inserted=${inserted} retired=${retired.rowCount}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_INGEST_PA_FAILED:', e.message); process.exit(1); });
}

module.exports = { parsePaList };
