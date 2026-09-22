#!/usr/bin/env node
// Ingest Florida OMMU "Qualified Physician List" text (tmp/qplist.txt, parsed
// from the weekly PDF) into cannabis_certifications. One row per qualifying
// physician, keyed by (state, license_number); providers are matched to
// certifications by license number, so names are informational and NPIs are
// not published by the source (NULL).
//
// The parsed text is nominally fixed-width, but the PDF extractor emits each
// page with its own column positions (measured here per page from the page's
// "Last Name First Name Licence ..." header line) and ragged rows: some
// physicians come out on one line, others split into a name/date/address
// fragment plus a trailing last-name/license fragment. Fragments are rejoined
// in original list order, which the extractor preserves (both the source
// list and each fragment sequence are in the same order); the rejoin count
// is printed so a future layout change is visible. The source labels its
// name columns "Last Name"/"First Name" but fills them first-then-last
// ("GREG WESTWOOD"); rows store the actual first/last. Address/phone are not
// stored (not needed for matching).
//
// Usage: node tools/cannabis-ingest.js [path-to-file] [--dry-run]
//        (default path: tmp/qplist.txt)

const fs = require('fs');

const DEFAULT_FILE = 'tmp/qplist.txt';
const STATE = 'FL';
const PROGRAM_NAME = 'Florida Medical Marijuana Program';
const SOURCE_NAME = 'FL OMMU Qualified Physician List';
const SOURCE_URL = 'https://knowthefactsmmj.com/physicians/list/';
const RETRIEVAL_METHOD = 'weekly PDF parse';
// FL DOH license prefixes appearing in this source: ME (physician), OS
// (osteopathic physician), ACN (advanced clinical nurse).
const LICENSE_PREFIX_RE = /(ME|OS|ACN)\d+$/;
const LICENSE_SHAPE_RE = /^[A-Za-z]+\d+$/;
const ROW_DATE_RE = /(\d{1,2}-[A-Za-z]{3}-\d{2})\b/;

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

function monthNum(mon) {
  const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(mon.slice(0, 3).toLowerCase());
  return idx === -1 ? null : idx + 1;
}

// "3-Apr-26" -> "2026-04-03"; null when the shape or month is off.
function parseRowDate(tok) {
  const m = tok.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mon = monthNum(m[2]);
  if (!mon) return null;
  return `20${m[3]}-${String(mon).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// "September 11, 2026" -> "2026-09-11"
function parseListUpdated(line) {
  const m = (line || '').match(/List Updated ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const mon = monthNum(m[1]);
  if (!mon) return null;
  return `${m[3]}-${String(mon).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

// Split a candidate token into license number and leftover name fragment.
// Rows like "LOPEZ BERMUDEZME124778" glue the last name onto the license.
function splitLicense(tok) {
  const m = tok.match(LICENSE_PREFIX_RE);
  if (!m) return { license: tok, remainder: '' };
  return { license: m[0], remainder: tok.slice(0, m.index) };
}

function joinName(base, remainder) {
  if (!remainder) return base;
  if (!base) return remainder;
  if (base.endsWith('-') || remainder.startsWith('-')) return base + remainder;
  return `${base} ${remainder}`;
}

// Parse the whole list text. Returns { asOf, rows, stats }.
function parseQpList(text) {
  const lines = text.split(/\r?\n/);
  const asOf = parseListUpdated(lines[0]);
  if (!asOf) throw new Error('no "List Updated <Month D, YYYY>" line found');

  // Section 1 is the qualified-physician list (has a Licence column).
  // Section 2 is a specialty index of the same physicians with scrambled
  // rows and no license numbers; it cannot be keyed and is not parsed.
  let section2At = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (/Last Name/.test(lines[i]) && /Specialties/.test(lines[i])) { section2At = i; break; }
  }

  const pages = [];
  for (let i = 0; i < section2At; i++) {
    if (/Last Name/.test(lines[i]) && /Licence/.test(lines[i])) {
      pages.push({ headerIndex: i, header: lines[i].replace(/^\f/, '') });
    }
  }
  if (pages.length === 0) throw new Error('no "Last Name ... Licence" header lines found');

  const stats = {
    complete: 0, rejoined: 0, fragmentOnly: 0, noLicense: 0,
    badLicense: 0, other: 0, phoneOnly: 0
  };
  const rows = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const pageEnd = pi + 1 < pages.length ? pages[pi + 1].headerIndex : section2At;
    const firstStart = pages[pi].header.indexOf('First Name');
    const addrStart = pages[pi].header.indexOf('Address');
    const cityStart = pages[pi].header.indexOf('City');
    const cityEnd = pages[pi].header.indexOf('State');
    const phoneStart = pages[pi].header.indexOf('Phone Number');
    const pageFirstOnly = [];
    const pageFragments = [];
    let pendingPhone = null;

    // City/zip are stored on parsed rows but not persisted (the schema keeps
    // address fields out); cannabis-npi-enrich.js and cannabis-npi-review.js
    // use them for their audit gates when re-parsing this file.
    const cityOf = raw => (cityStart === -1 ? '' : raw.slice(cityStart, cityEnd === -1 ? undefined : cityEnd).trim());
    const zipOf = raw => {
      // The data rows right-align city+state+zip as a unit, so the zip
      // anchors off the State column rather than the header's Zip offset
      // (which the ragged rows do not honor).
      if (cityEnd === -1) return '';
      const seg = raw.slice(cityEnd, cityEnd + 16);
      const m = seg.match(/^\s*([A-Z]{2})\s+(\d{5})/);
      return m ? m[2] : '';
    };

    for (let i = pages[pi].headerIndex + 1; i < pageEnd; i++) {
      const raw = lines[i];
      if (!raw || !raw.trim()) continue;

      // Phone-only lines precede the data row they belong to; buffer and
      // attach. The number itself is not persisted (not needed for matching).
      if (phoneStart !== -1 && !raw.slice(0, phoneStart).trim() && raw.slice(phoneStart).trim()) {
        stats.phoneOnly++;
        pendingPhone = raw.slice(phoneStart).trim();
        continue;
      }

      const col0 = raw.slice(0, firstStart).trim();
      const seg = raw.slice(firstStart, addrStart === -1 ? undefined : addrStart);

      // Complete row: name, license, date.
      const cm = seg.match(/^(.*?)([A-Za-z]+\d+)\s+(\d{1,2}-[A-Za-z]{3}-\d{2})\b/);
      if (cm) {
        const { license, remainder } = splitLicense(cm[2]);
        if (!LICENSE_SHAPE_RE.test(license)) {
          stats.badLicense++;
          console.warn(`  warn: license "${license}" (line ${i + 1}) does not look like an FL license; row skipped`);
          continue;
        }
        const listDate = parseRowDate(cm[3]);
        if (!listDate) {
          stats.badLicense++;
          console.warn(`  warn: unparsable list date "${cm[3]}" (line ${i + 1}); row skipped`);
          continue;
        }
        const phone = raw.slice(phoneStart === -1 ? raw.length : phoneStart).trim();
        if (!phone) pendingPhone = null; // consumed by this row
        // The source labels its name columns "Last Name"/"First Name" but
        // fills them first-name-then-last-name ("GREG WESTWOOD"); store the
        // actual first/last, not the labels.
        rows.push({
          first: col0,
          last: joinName(cm[1].trim(), remainder),
          license,
          listDate,
          city: cityOf(raw),
          zip: zipOf(raw),
          splitRow: false
        });
        stats.complete++;
        continue;
      }

      // Fragment row: last name + license, no date (the rest of the same
      // physician's row was emitted as a first-only line above).
      const fm = seg.match(/^(.*?)([A-Za-z]+\d+)\s*$/);
      if (fm && !col0) {
        const { license, remainder } = splitLicense(fm[2]);
        if (!LICENSE_SHAPE_RE.test(license)) {
          stats.badLicense++;
          console.warn(`  warn: license "${license}" (line ${i + 1}) does not look like an FL license; row skipped`);
          continue;
        }
        pageFragments.push({ last: joinName(fm[1].trim(), remainder), license });
        continue;
      }

      // First-only fragment: first name + date + address, no last/license.
      const dm = seg.match(ROW_DATE_RE);
      if (col0 && dm && !/[A-Za-z]+\d+/.test(seg.slice(0, dm.index))) {
        const listDate = parseRowDate(dm[1]);
        if (!listDate) {
          stats.badLicense++;
          console.warn(`  warn: unparsable list date "${dm[1]}" (line ${i + 1}); row skipped`);
          continue;
        }
        const phone = raw.slice(phoneStart === -1 ? raw.length : phoneStart).trim();
        pageFirstOnly.push({ first: col0, listDate, city: cityOf(raw), zip: zipOf(raw), phone: phone || pendingPhone || null });
        pendingPhone = null;
        continue;
      }

      stats.other++;
    }

    // Rejoin split rows. Both fragment sequences preserve the list order, so
    // the k-th first-only line pairs with the k-th fragment. A page whose
    // counts disagree means the layout changed: keep the licenses (nameless,
    // dateless) instead of guessing pairings.
    if (pageFirstOnly.length !== pageFragments.length) {
      console.warn(`  warn: page at line ${pages[pi].headerIndex + 1} has ${pageFirstOnly.length} split rows but ${pageFragments.length} license fragments; pairing skipped for this page`);
    }
    const n = pageFirstOnly.length === pageFragments.length ? pageFirstOnly.length : 0;
    for (let k = 0; k < n; k++) {
      rows.push({
        first: pageFirstOnly[k].first,
        last: pageFragments[k].last,
        license: pageFragments[k].license,
        listDate: pageFirstOnly[k].listDate,
        city: pageFirstOnly[k].city,
        zip: pageFirstOnly[k].zip,
        splitRow: true
      });
      stats.rejoined++;
    }
    for (let k = n; k < pageFragments.length; k++) {
      rows.push({ first: null, last: pageFragments[k].last, license: pageFragments[k].license, listDate: null, city: '', zip: '', splitRow: true });
      stats.fragmentOnly++;
    }
    stats.noLicense += pageFirstOnly.length - n;
  }

  return { asOf, rows, stats, section2At, totalLines: lines.length };
}

async function main() {
  const args = parseArgs(process.argv);
  const text = fs.readFileSync(args.file, 'utf8');
  const { asOf, rows, stats, section2At, totalLines } = parseQpList(text);

  console.log(`source as_of (list updated): ${asOf}`);
  console.log(`parsed rows: ${rows.length} (complete=${stats.complete} rejoined=${stats.rejoined} fragment-only=${stats.fragmentOnly})`);
  console.log(`skipped: no-license=${stats.noLicense} bad-license=${stats.badLicense} other=${stats.other} (phone-only lines attached: ${stats.phoneOnly})`);
  if (section2At < totalLines) {
    console.log(`note: specialty index section at line ${section2At + 1} ignored (no license numbers, same physicians)`);
  }

  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.license)) console.warn(`  warn: duplicate license ${r.license} in source; last row wins on upsert`);
    seen.add(r.license);
  }

  if (args.dryRun) {
    for (const r of rows.slice(0, 3)) {
      console.log(`sample: ${r.last}, ${r.first || '(none)'} | ${r.license} | ${r.listDate || '(no date)'}${r.splitRow ? ' | split row' : ''}`);
    }
    console.log(`CANNABIS_INGEST_DRY_RUN rows=${rows.length} skipped=${stats.noLicense + stats.badLicense + stats.other}`);
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
    // npi is owned by cannabis-npi-enrich.js and is deliberately absent from
    // the ON CONFLICT update list. Its provenance segment is not: carry any
    // existing "NPI matched/quarantined" note forward onto the fresh date
    // note so weekly re-ingests stay lossless.
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
      const noteParts = [`OMMU list date: ${r.listDate || 'unavailable'}`];
      if (r.splitRow) noteParts.push('rejoined from split row (list order)');
      const res = await c.query(
        `INSERT INTO cannabis_certifications (
           state, source_name, source_url,
           practitioner_first_name, practitioner_last_name, credential, npi,
           license_number, certification_status, program_name, as_of,
           retrieval_method, provenance_note
         ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (state, license_number) DO UPDATE SET
           practitioner_first_name = EXCLUDED.practitioner_first_name,
           practitioner_last_name = EXCLUDED.practitioner_last_name,
           certification_status = EXCLUDED.certification_status,
           as_of = EXCLUDED.as_of,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           retrieval_method = EXCLUDED.retrieval_method,
           provenance_note = EXCLUDED.provenance_note
         RETURNING (xmax = 0) AS was_inserted`,
        [
          STATE, SOURCE_NAME, SOURCE_URL,
          r.first, r.last, r.license,
          // The source publishes one "Qualified Physician List"; presence on
          // it is the published qualification, so the status is as-published.
          'qualified', PROGRAM_NAME, asOf,
          RETRIEVAL_METHOD, noteParts.join('; ') + (npiNoteByLicense.get(r.license) || '')
        ]
      );
      if (res.rows[0] && res.rows[0].was_inserted) inserted++; else updated++;
    }
    await c.query('COMMIT');
    console.log(`CANNABIS_INGEST_OK inserted=${inserted} updated=${updated} skipped=${stats.noLicense + stats.badLicense + stats.other}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_INGEST_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseQpList, parseRowDate };
