#!/usr/bin/env node
// Ingest the Alabama Medical Cannabis Commission "Registered Certifying
// Physicians" PDF text (tmp/al-physicians.txt, via pdftotext -layout) into
// cannabis_certifications. First license-less source: the AMCC list
// publishes no license number or NPI, so rows cannot be keyed — the ingest
// mirrors the current list with replace-per-source semantics (DELETE the
// source's rows, INSERT the parse) inside one transaction. The PDF states
// its own "Current as of" date, which becomes as_of. Address columns are not
// stored (schema keeps addresses out); specialty, city, and registration
// expiration ride in provenance_note for review context.
//
// Usage: node tools/cannabis-ingest-al.js [path-to-file] [--dry-run]
//        (default path: tmp/al-physicians.txt)

const fs = require('fs');

const DEFAULT_FILE = 'tmp/al-physicians.txt';
const STATE = 'AL';
const PROGRAM_NAME = 'Alabama Medical Cannabis Commission';
const SOURCE_NAME = 'AMCC Registered Certifying Physicians';
const SOURCE_URL = 'https://amcc.alabama.gov/wp-content/uploads/2026/09/AMCC-Registered-Certifying-Physicians.pdf';
const RETRIEVAL_METHOD = 'PDF parse';
// The list presents everyone as "Registered Certifying Physicians"; the
// status is as-published.
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

// "9/18/2026" -> "2026-09-18"; null when unparseable.
function parseUsDate(tok) {
  const m = String(tok || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// Parse the whole list text. Returns { asOf, rows, stats }.
function parseAlList(text) {
  const lines = text.split(/\r?\n/);

  const asOfLine = lines.find(l => /Current as of/.test(l)) || '';
  const asOfM = asOfLine.match(/Current as of (\d{1,2}\/\d{1,2}\/\d{4})/);
  const asOf = asOfM ? parseUsDate(asOfM[1]) : null;
  if (!asOf) throw new Error('no "Current as of M/D/YYYY" line found');

  const headerIndex = lines.findIndex(l => /Physician Name/.test(l));
  if (headerIndex === -1) throw new Error('no "Physician Name" header line found');

  // The header row is centered on the title page and does not align with the
  // table body, and the body's column drift means every line is calibrated on
  // its own phone column: county <= 10 chars in a 12-wide window ending at the
  // phone, city in the 16-wide window before that. Values with digits or that
  // duplicate the county are rejected.
  const PHONE_RE = /(\d{3}[- ]*\d{3}[- ]*\d{4})/;
  const cleanCell = v => {
    const t = (v || '').trim();
    if (!t || /\d/.test(t) || /\s{2,}/.test(t)) return '';
    if (/\b(Suite|Ste|St|Dr|Rd|Ave|Blvd|Hwy|Pkwy|Loop|Circle|Hwy|Drive|Ln)\b/.test(t)) return '';
    return t;
  };
  const cityCountyOf = raw => {
    const pm = raw.match(PHONE_RE);
    if (!pm) return { city: '', county: '' };
    const p = pm.index;
    const county = cleanCell(raw.slice(p - 12, p));
    const city = cleanCell(raw.slice(p - 28, p - 12));
    return { city, county };
  };
  const specOf = raw => {
    const m = raw.match(/,?\s*\((MD|DO)\)/);
    if (!m) return '';
    const rest = raw.slice(m.index + m[0].length);
    const sm = rest.match(/^\s*([A-Za-z][A-Za-z, ()&-]*?[A-Za-z)])\s{2,}/);
    return sm ? sm[1].trim() : '';
  };
  const expOf = raw => {
    const m = raw.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    return m ? m[1] : '';
  };

  const stats = { blocks: 0, noCity: 0, noExpiration: 0 };
  const rows = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const [last, ...rest] = cur.name.split(',').map(s => s.trim());
    const note = [`AMCC list "Current as of ${asOf}"`];
    if (cur.specialty) note.push(`specialty: ${cur.specialty}`);
    if (cur.city) note.push(`city: ${cur.city}`);
    if (cur.county) note.push(`county: ${cur.county}`);
    if (cur.expiration) note.push(`registration expires: ${cur.expiration}`);
    rows.push({
      first: rest.join(', '),
      last,
      credential: cur.cred,
      specialty: cur.specialty,
      city: cur.city,
      county: cur.county,
      expiration: cur.expiration,
      provenance: note.join('; ')
    });
    if (!cur.city) stats.noCity++;
    if (!cur.expiration) stats.noExpiration++;
  };

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i];
    const nm = raw.match(/^([A-Za-z][A-Za-z .,'-]{2,60}?),?\s*\((MD|DO)\)/);
    if (nm) {
      flush();
      stats.blocks++;
      cur = { name: nm[1].trim(), cred: nm[2], lines: [raw], specialty: '', city: '', county: '', expiration: '' };
    }
    if (!cur) continue;
    if (!raw.trim()) continue;
    if (!nm) cur.lines.push(raw);
    // Wrapped cells: specialty/address lines above or below the name line.
    const spec = specOf(raw);
    if (spec && !cur.specialty) cur.specialty = spec;
    const { city, county } = cityCountyOf(raw);
    if (city && !cur.city) cur.city = city;
    if (county && !cur.county) cur.county = county;
    const exp = expOf(raw);
    if (exp && !cur.expiration) cur.expiration = exp;
  }
  flush();

  return { asOf, rows, stats };
}

async function main() {
  const args = parseArgs(process.argv);
  const text = fs.readFileSync(args.file, 'utf8');
  const { asOf, rows, stats } = parseAlList(text);

  console.log(`source as_of (Current as of): ${asOf}`);
  console.log(`parsed physicians: ${rows.length} (without parsed city: ${stats.noCity})`);

  if (args.dryRun) {
    for (const r of rows.slice(0, 3)) {
      console.log(`sample: ${r.last}, ${r.first} (${r.credential}) | ${r.city || '(no city)'} | expires ${r.expiration || '(none)'}`);
    }
    console.log(`CANNABIS_INGEST_AL_DRY_RUN rows=${rows.length}`);
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
    // Upsert by natural name key (no license exists): confirm survivors,
    // insert newcomers, retire names absent from this edition. Matched NPIs
    // and their provenance survive re-ingests; the provenance_note is only
    // written on first insert.
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
    console.log(`CANNABIS_INGEST_AL_OK confirmed=${seen.rows.length} inserted=${inserted} retired=${retired.rowCount}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('CANNABIS_INGEST_AL_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseAlList };
