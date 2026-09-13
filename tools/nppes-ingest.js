#!/usr/bin/env node
// NPPES V.2 ingest: direct CSV-to-Postgres loader for the NPPES provider file.
//
// Table design (nppes_providers) is deliberately narrow. Kept columns are the
// ones the platform's identity, exclusion-name-fallback, and verification
// queries touch: NPI identity (entity type, replacement NPI), provider name,
// legal business name, parent organization, primary taxonomy, practice and
// mailing addresses, and enumeration/last-update dates. Out of scope for v1
// and still available in the raw file: secondary taxonomy slots 2..15,
// license numbers, taxonomy groups, the 50 other-provider identifier slots,
// authorized official block, and the endpoint/pl/othername reference files.
//
// Primary taxonomy selection, per the V.2 readme: the Primary Taxonomy Switch
// flag marks the primary slot. The readme documents value 'X'; the live
// August 2026 file actually uses 'Y' (and 'N'), so a slot counts as primary
// when its switch is 'X' or 'Y'. If no slot is flagged, fall back to slot 1;
// if every slot is empty, store null.
//
// primary_taxonomy_description is reserved: NPPES carries taxonomy codes only.
// It stays null on insert and will be backfilled from the NUCC taxonomy
// reference (the providers cache already maps codes to descriptions).
//
// Usage: node tools/nppes-ingest.js --file <csv> [--limit n] [--source label]

const fs = require('fs');
const path = require('path');

// Header names in the V.2 provider file. Columns are located by name from
// the first line of the file, never by position.
const COLS = {
  npi: 'NPI',
  entity_type_code: 'Entity Type Code',
  replacement_npi: 'Replacement NPI',
  name_prefix: 'Provider Name Prefix Text',
  first_name: 'Provider First Name',
  middle_name: 'Provider Middle Name',
  last_name: 'Provider Last Name (Legal Name)',
  suffix: 'Provider Name Suffix Text',
  credential: 'Provider Credential Text',
  legal_business_name: 'Provider Organization Name (Legal Business Name)',
  parent_organization_lbn: 'Parent Organization LBN',
  enumeration_date: 'Provider Enumeration Date',
  last_update_date: 'Last Update Date'
};

const ADDR_FIELDS = [
  ['address_line1', 'Provider First Line Business {which} Address'],
  ['address_line2', 'Provider Second Line Business {which} Address'],
  ['city', 'Provider Business {which} Address City Name'],
  ['state', 'Provider Business {which} Address State Name'],
  ['zip', 'Provider Business {which} Address Postal Code'],
  ['country', 'Provider Business {which} Address Country Code (If outside U.S.)'],
  ['phone', 'Provider Business {which} Address Telephone Number'],
  ['fax', 'Provider Business {which} Address Fax Number']
];

function resolveColumnNames() {
  const names = Object.assign({}, COLS);
  for (const [prefix, which] of [['practice', 'Practice Location'], ['mailing', 'Mailing']]) {
    for (const [short, pattern] of ADDR_FIELDS) {
      names[`${prefix}_${short}`] = pattern.replace('{which}', which);
    }
  }
  return names;
}

// Dates in the file are MM/DD/YYYY; store as date, null on empty.
function parseDate(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Returns { code, switchValue } or null. See the header comment for the
// switch-flag rule: flagged slot wins, else slot 1, else null.
function pickPrimaryTaxonomy(fields, headerIndex) {
  for (let n = 1; n <= 15; n++) {
    const sw = clean(fields[headerIndex[`Healthcare Provider Primary Taxonomy Switch_${n}`]]);
    if (sw === 'X' || sw === 'Y') {
      const code = clean(fields[headerIndex[`Healthcare Provider Taxonomy Code_${n}`]]);
      return { code: code || null, switchValue: sw };
    }
  }
  const first = clean(fields[headerIndex['Healthcare Provider Taxonomy Code_1']]);
  if (first) return { code: first, switchValue: 'fallback_1' };
  return { code: null, switchValue: null };
}

function mapRow(fields, headerIndex, source, asOf) {
  const o = {};
  for (const [key, name] of Object.entries(resolveColumnNames())) {
    o[key] = clean(fields[headerIndex[name]]);
  }
  const tax = pickPrimaryTaxonomy(fields, headerIndex);
  o.primary_taxonomy_code = tax.code;
  o.primary_taxonomy_description = null; // reserved: backfilled from NUCC reference
  o.taxonomy_switch = tax.switchValue;
  o.enumeration_date = parseDate(o.enumeration_date);
  o.last_update_date = parseDate(o.last_update_date);
  o.source = source;
  o.as_of = asOf;
  return o;
}

// Quote-aware line splitter. Embedded double quotes are replaced with single
// quotes by CMS, so standard "" unescaping plus plain passthrough of ' is
// enough (same approach as tools/leie-ingest.ps1).
function parseLine(line) {
  const rec = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { rec.push(field); field = ''; }
    else field += ch;
  }
  rec.push(field);
  return rec;
}

// Synchronous full-file parser used by tests and as documentation of the
// streaming state machine below.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  return lines.map(parseLine);
}

const DDL = `CREATE TABLE IF NOT EXISTS nppes_providers (
  npi text PRIMARY KEY,
  entity_type_code text,
  replacement_npi text,
  name_prefix text,
  first_name text,
  middle_name text,
  last_name text,
  suffix text,
  credential text,
  legal_business_name text,
  parent_organization_lbn text,
  primary_taxonomy_code text,
  primary_taxonomy_description text,
  taxonomy_switch text,
  practice_address_line1 text,
  practice_address_line2 text,
  practice_city text,
  practice_state text,
  practice_zip text,
  practice_country text,
  practice_phone text,
  practice_fax text,
  mailing_address_line1 text,
  mailing_address_line2 text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  mailing_country text,
  mailing_phone text,
  mailing_fax text,
  enumeration_date date,
  last_update_date date,
  source text,
  as_of date
)`;

function parseArgs(argv) {
  const args = { file: null, limit: null, source: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--source') args.source = argv[++i];
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (!args.file) { console.error('Usage: node tools/nppes-ingest.js --file <csv> [--limit n] [--source label]'); process.exit(1); }
  if (!args.source) args.source = path.basename(args.file);
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const { Client } = require('pg');
  const AS_OF = new Date().toISOString().slice(0, 10);

  const env = {};
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch (e) { /* fall back to process env / defaults below */ }

  const c = new Client({
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || process.env.DB_PORT || '5432', 10),
    database: env.DB_NAME || process.env.DB_NAME || 'provider_intelligence',
    user: env.DB_USER || process.env.DB_USER || 'admin',
    password: env.DB_PASSWORD || process.env.DB_PASSWORD || ''
  });

  let headerIndex = null;
  let parsed = 0;
  let inQ = false, field = '', rec = [];
  let batch = [];
  let inserted = 0;
  let stopped = false;

  function flush() {
    if (!batch.length) return Promise.resolve();
    const items = batch; // snapshot before async boundary
    batch = [];
    return c.query(
      'INSERT INTO nppes_providers SELECT * FROM jsonb_populate_recordset(null::nppes_providers, $1::jsonb)',
      [JSON.stringify(items)]
    ).then(() => {
      inserted += items.length;
      if (inserted % 10000 === 0) console.log(`  ${inserted} inserted...`);
    });
  }

  function handleRecord(cols) {
    if (!headerIndex) {
      headerIndex = {};
      cols.forEach((h, i) => { headerIndex[h.trim()] = i; });
      return Promise.resolve();
    }
    if (args.limit !== null && parsed >= args.limit) {
      stopped = true;
      return Promise.resolve();
    }
    parsed++;
    batch.push(mapRow(cols, headerIndex, args.source, AS_OF));
    if (batch.length >= 1000) return flush();
    return Promise.resolve();
  }

  (async () => {
    await c.connect();
    await c.query(DDL);
    await c.query('TRUNCATE nppes_providers');
    console.log('table truncated, streaming CSV...');

    // Backpressure: async iteration pauses the read stream while a record is
    // being handled, so a flush at the batch boundary is awaited before the
    // next chunk is pulled. The previous fire-and-forget promise chain let the
    // parser outrun the inserts and grew the pg query queue without bound
    // (V8 heap OOM around 860k rows on the full file). Parse state (inQ,
    // field, rec) still persists across chunks.
    const stream = fs.createReadStream(args.file);
    for await (const chunk of stream) {
      if (stopped) { stream.destroy(); break; }
      const s = chunk.toString('utf8');
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQ) {
          if (ch === '"') {
            if (s[i + 1] === '"') { field += '"'; i++; }
            else inQ = false;
          } else field += ch;
        } else if (ch === '"') { inQ = true; }
        else if (ch === ',') { rec.push(field); field = ''; }
        else if (ch === '\n') { rec.push(field); field = ''; const r = rec; rec = []; await handleRecord(r); }
        else if (ch === '\r') { /* skip */ }
        else field += ch;
      }
    }
    if (field.length || rec.length) { rec.push(field); await handleRecord(rec); }
    await flush();

    const r = await c.query('SELECT COUNT(*) AS total FROM nppes_providers');
    const table = parseInt(r.rows[0].total, 10);
    if (parsed !== inserted || inserted !== table) {
      console.error(`INGEST_FAILED parsed=${parsed} inserted=${inserted} table=${table}`);
      process.exit(1);
    }
    console.log(`INGEST_OK parsed=${parsed} inserted=${inserted} table=${table}`);
    await c.end();
  })().catch(e => { console.error('INGEST_FAILED:', e.message); process.exit(1); });
}

module.exports = { parseLine, parseCsv, parseDate, pickPrimaryTaxonomy, mapRow, resolveColumnNames };

if (require.main === module) { main(); }
