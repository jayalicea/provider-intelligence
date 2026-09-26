#!/usr/bin/env node
// Ingest the Oklahoma OMMA "Registered Physicians" PDF text
// (tmp/ok-physicians.txt, via pdftotext -layout) into
// cannabis_certifications. SB 1066 registration list; physicians opted in
// to public listing, so coverage is voluntary (absence != unregistered).
// Like AL/PA the source publishes no license number: rows are name-keyed.
// Address lines carry city/state/ZIP for the NPPES match/resolver signals.
// The PDF is undated; as_of is the access date (same convention as WV).
//
// Usage: node tools/cannabis-ingest-ok.js [path-to-file] [--dry-run]
//        (default path: tmp/ok-physicians.txt)

const fs = require('fs');

const DEFAULT_FILE = 'tmp/ok-physicians.txt';
const STATE = 'OK';
const PROGRAM_NAME = 'Oklahoma Medical Marijuana Authority';
const SOURCE_NAME = 'OMMA Registered Physicians';
const SOURCE_URL = 'https://oklahoma.gov/content/dam/ok/en/omma/forms/Registered%20Physicians.pdf';
const RETRIEVAL_METHOD = 'PDF parse';
const CERTIFICATION_STATUS = 'registered';

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

// Columns are 2+-space separated, but the Type column can be separated
// from the practice by a single space ("MD Akram R Abraham..."), so match
// the entry prefix explicitly and split the remainder by 2+ spaces.
const ENTRY_RE = /^\s*([A-Za-z][A-Za-z .''-]*?)\s{2,}([A-Za-z][A-Za-z .''-]*?)\s{2,}(MD|DO)\s+(.*\S)\s*$/;
const HEADER_RE = /^\s*First Name\s+Last Name\s+Type\b/;
const CITYStateZip_RE = /([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z]{2})\s+(\d{5})/;
const PHONE_RE = /\(\d{3}\)\s?\d{3}-\d{4}/;

function absorbLocation(cur, text) {
  if (!text) return;
  const m = text.match(CITYStateZip_RE);
  if (m && !cur.city) {
    cur.city = m[1].trim().toUpperCase();
    cur.state = m[2].toUpperCase();
    cur.zip = m[3];
  }
  const p = text.match(PHONE_RE);
  if (p && !cur.phone) cur.phone = p[0];
}

// Parse the whole list text. Returns { asOf, rows, stats }.
function parseOkList(text, accessDate = new Date().toISOString().slice(0, 10)) {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex(l => HEADER_RE.test(l));
  if (startIdx === -1) throw new Error('column header row not found');

  const rows = [];
  const stats = { entries: 0, noCity: 0, duplicateNames: 0 };
  const seen = new Set();

  let cur = null;
  const flush = () => {
    if (!cur) return;
    const key = `${cur.last}|${cur.first}`;
    if (seen.has(key)) { stats.duplicateNames++; cur = null; return; }
    seen.add(key);
    const prov = [`OMMA SB 1066 registration list (undated), accessed ${accessDate}`];
    if (cur.practice) prov.push(`practice: ${cur.practice}`);
    rows.push({
      first: cur.first,
      last: cur.last,
      credential: cur.type,
      city: cur.city || '',
      state: cur.state || '',
      zip: cur.zip || '',
      practice: cur.practice || '',
      phone: cur.phone || '',
      provenance: prov.join('; ')
    });
    stats.entries++;
    if (!cur.city) stats.noCity++;
    cur = null;
  };

  for (const raw of lines.slice(startIdx + 1)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const entry = line.match(ENTRY_RE);
    if (entry) {
      flush();
      cur = { first: entry[1].trim(), last: entry[2].trim(), type: entry[3],
              practice: '', city: '', state: '', zip: '', phone: '' };
      const rest = entry[4].split(/\s{2,}/);
      for (const seg of rest) absorbLocation(cur, seg);
      // First non-location segment is the practice name; a segment that
      // starts with a digit is an address fragment (practice column empty).
      for (const seg of rest) {
        if (CITYStateZip_RE.test(seg) || PHONE_RE.test(seg)) continue;
        if (/^\d/.test(seg.trim())) continue;
        if (!cur.practice) { cur.practice = seg.trim(); break; }
      }
      continue;
    }
    if (cur) {
      const segs = line.trim().split(/\s{2,}/);
      for (const seg of segs) absorbLocation(cur, seg);
      // Continuation segments that are not locations/addresses backfill a
      // wrapped practice name (e.g. "Abraham Medical clinic").
      for (const seg of segs) {
        if (CITYStateZip_RE.test(seg) || PHONE_RE.test(seg)) continue;
        if (/^\d/.test(seg.trim())) continue;
        if (!cur.practice) { cur.practice = seg.trim(); break; }
      }
    }
  }
  flush();

  return { asOf: accessDate, rows, stats };
}

async function main() {
  const args = parseArgs(process.argv);
  const text = fs.readFileSync(args.file, 'utf8');
  const { asOf, rows, stats } = parseOkList(text);

  console.log(`source as_of (access date, PDF undated): ${asOf}`);
  console.log(`parsed physicians: ${rows.length} (without parsed city: ${stats.noCity}, duplicate names: ${stats.duplicateNames})`);

  if (args.dryRun) {
    for (const r of rows.slice(0, 3)) {
      console.log(`sample: ${r.last}, ${r.first} (${r.credential}) | ${r.city || '(no city)'} ${r.state} ${r.zip} | ${r.practice || '(no practice)'} | ${r.phone}`);
    }
    console.log(`CANNABIS_INGEST_OK_DRY_RUN rows=${rows.length}`);
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
    console.log(`CANNABIS_INGEST_OK_OK confirmed=${seen.rows.length} inserted=${inserted} retired=${retired.rowCount}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_INGEST_OK_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseOkList };
