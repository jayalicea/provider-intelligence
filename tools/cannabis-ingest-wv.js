#!/usr/bin/env node
// Ingest the West Virginia OMC "PHYSICIANS LIST - UPDATED" PDF text
// (tmp/wv-physicians.txt, via pdftotext -layout) into cannabis_certifications.
// WV is the second state on the multi-state schema; matching stays
// license-number-keyed on WV medical licenses (PHY + 6 digits). The PDF is a
// county-grouped, three-column roster (Physician | Specialty | Contact); the
// parser keys on the "Name, CRED - PHY######" data lines, tracks the current
// county/group header, and keeps specialty/contact out (not needed for
// matching), same policy as the FL ingest. The PDF carries no date: as_of is
// the access date and each row's provenance_note says so. Physicians listed
// without a PHY license cannot be keyed: counted and skipped.
//
// Usage: node tools/cannabis-ingest-wv.js [path-to-file] [--dry-run]
//        (default path: tmp/wv-physicians.txt)

const fs = require('fs');

const DEFAULT_FILE = 'tmp/wv-physicians.txt';
const STATE = 'WV';
const PROGRAM_NAME = 'West Virginia Medical Cannabis Program';
const SOURCE_NAME = 'WV OMC Physicians List';
const SOURCE_URL = 'https://omc.wv.gov/patients/schedule-an-appointment/Documents/PHYSICIANS%20LIST%20-%20UPDATED.pdf';
const RETRIEVAL_METHOD = 'PDF parse';
// WV Board of Medicine license shape in this source: PHY + 6 digits.
const LICENSE_SHAPE_RE = /^PHY\d{6}$/;

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

// Parse the whole list text. Returns { rows, stats }.
function parseWvList(text) {
  const lines = text.split(/\r?\n/);
  const stats = { keyed: 0, noLicense: 0, badLicense: 0, duplicate: 0 };
  const rows = [];
  const seen = new Set();
  let group = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (/^\d+$/.test(line)) continue;                      // page numbers
    if (/\.{4,}/.test(line)) continue;                     // table of contents dot leaders
    if (/^Specialty\b/.test(line) || /^Physician\b.*Specialty/.test(line)) continue; // column titles

    // Section headers are bare lines (no dot leaders): "Berkeley County",
    // "OUT OF STATE Registered Physicians", "Telehealth Companies". On the
    // first page of a section the header shares its line with the column
    // titles ("Berkeley County   Specialty   Contact Information").
    const hm = line.match(/^([A-Za-z][A-Za-z ]*(?: County|Registered Physicians|Telehealth Companies))(?:\s{2,}Specialty.*)?$/);
    if (hm) { group = hm[1]; continue; }

    // Data line: "First Last[, CRED] - PHY######" (specialty/contact may
    // trail after the license on the same line).
    const dm = line.match(/^([A-Za-z][A-Za-z .,'-]*?)(?:,\s*([A-Z]{2,4}))?\s+-\s+([A-Za-z]*\d+[A-Za-z]*)\b/);
    if (dm) {
      const license = dm[3];
      if (!LICENSE_SHAPE_RE.test(license)) {
        stats.badLicense++;
        console.warn(`  warn: license "${license}" (line ${i + 1}) does not look like a WV PHY license; row skipped`);
        continue;
      }
      if (seen.has(license)) stats.duplicate++;
      seen.add(license);
      const namePart = dm[1].trim();
      const tokens = namePart.split(/\s+/);
      const last = tokens.pop();
      rows.push({
        first: tokens.join(' '),
        last,
        credential: dm[2] || null,
        license,
        group: group || 'unknown'
      });
      stats.keyed++;
      continue;
    }

    // Physician listed without a license: cannot be keyed. (Lines with a
    // license were consumed above, so anything matching "Name, CRED" here has
    // none; contact info may trail on the same line.)
    if (/^[A-Za-z][A-Za-z .,'-]*,\s*(MD|DO|NP|PA|APRN|DPM)\b/.test(line)) {
      stats.noLicense++;
      console.warn(`  warn: no PHY license on line ${i + 1}: "${line.slice(0, 60)}"; row skipped`);
      continue;
    }
  }

  return { rows, stats };
}

async function main() {
  const args = parseArgs(process.argv);
  const text = fs.readFileSync(args.file, 'utf8');
  const { rows, stats } = parseWvList(text);

  // The PDF carries no date; as_of is the access date.
  const asOf = new Date().toISOString().slice(0, 10);

  console.log(`access-date as_of (PDF undated): ${asOf}`);
  console.log(`parsed rows: ${rows.length} (duplicate listings in source: ${stats.duplicate})`);
  console.log(`skipped: no-license=${stats.noLicense} bad-license=${stats.badLicense}`);

  if (args.dryRun) {
    for (const r of rows.slice(0, 3)) {
      console.log(`sample: ${r.last}, ${r.first} | ${r.credential || '(no credential)'} | ${r.license} | ${r.group}`);
    }
    console.log(`CANNABIS_INGEST_WV_DRY_RUN rows=${rows.length} skipped=${stats.noLicense + stats.badLicense}`);
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
    // Same lossless policy as the FL ingest: npi is owned by the enrich tool
    // and never updated here; existing NPI-match provenance segments carry
    // forward (no WV rows have them yet, but a future enrich tool will).
    const existing = await c.query(
      'SELECT license_number, provenance_note FROM cannabis_certifications WHERE state = $1',
      [STATE]
    );
    const npiNoteByLicense = new Map();
    for (const row of existing.rows) {
      const m = (row.provenance_note || '').match(/ \| NPI (?:matched|match quarantined) \d{4}-\d{2}-\d{2}: [^|]*$/);
      if (m) npiNoteByLicense.set(row.license_number, m[0]);
    }

    await c.query('BEGIN');
    let inserted = 0, updated = 0;
    for (const r of rows) {
      // The OMC page presents these as "registered physicians"; the status
      // is as-published.
      const provenance = `as-of = access date, PDF undated; WV OMC group: ${r.group}` +
        (npiNoteByLicense.get(r.license) || '');
      const res = await c.query(
        `INSERT INTO cannabis_certifications (
           state, source_name, source_url,
           practitioner_first_name, practitioner_last_name, credential, npi,
           license_number, certification_status, program_name, as_of,
           retrieval_method, provenance_note
         ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (state, license_number) DO UPDATE SET
           practitioner_first_name = EXCLUDED.practitioner_first_name,
           practitioner_last_name = EXCLUDED.practitioner_last_name,
           credential = EXCLUDED.credential,
           certification_status = EXCLUDED.certification_status,
           as_of = EXCLUDED.as_of,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           retrieval_method = EXCLUDED.retrieval_method,
           provenance_note = EXCLUDED.provenance_note
         RETURNING (xmax = 0) AS was_inserted`,
        [
          STATE, SOURCE_NAME, SOURCE_URL,
          r.first, r.last, r.credential, r.license,
          'registered', PROGRAM_NAME, asOf,
          RETRIEVAL_METHOD, provenance
        ]
      );
      if (res.rows[0] && res.rows[0].was_inserted) inserted++; else updated++;
    }
    await c.query('COMMIT');
    console.log(`CANNABIS_INGEST_WV_OK inserted=${inserted} updated=${updated} skipped=${stats.noLicense + stats.badLicense}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_INGEST_WV_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseWvList };
