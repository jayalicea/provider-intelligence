#!/usr/bin/env node
// NPPES othername_pfile ingest: alternate names for Type 2 organizations.
//
// The main provider file carries one legal business name per NPI. This
// reference file carries the rest: doing-business-as names, former legal
// business names, and other names, keyed on NPI. Type code 3 (Doing Business
// As) is the one screening cares about -- an excluded business is matched by
// name, and the name a roster carries is frequently the DBA rather than the
// legal business name.
//
// The file is small (~48 MB) but the loader still reads with backpressure,
// for the same reason tools/nppes-ingest.js does: the stream is paced by the
// inserts rather than racing ahead of them.
//
// The header may carry a UTF-8 BOM, which would otherwise become part of the
// first column's name and break name-based lookup; it is stripped.
//
// Usage: node tools/nppes-othername-ingest.js --file <csv> [--limit n] [--source label]

const fs = require('fs');
const path = require('path');

// Located by header name, never by position.
const COLS = {
  npi: 'NPI',
  other_name: 'Provider Other Organization Name',
  other_name_type_code: 'Provider Other Organization Name Type Code'
};
// The created-date column is named inconsistently across vintages; accept any.
const CREATED_DATE_NAMES = [
  'Provider Other Organization Name Created Date',
  'Created Date',
  'Other Name Created Date'
];

const DDL = `CREATE TABLE IF NOT EXISTS nppes_othernames (
  npi text,
  other_name text,
  other_name_type_code text,
  created_date date,
  source text,
  as_of date
)`;

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_othernames_npi ON nppes_othernames(npi)',
  // Screening looks names up case- and punctuation-insensitively.
  "CREATE INDEX IF NOT EXISTS idx_othernames_name ON nppes_othernames(upper(regexp_replace(other_name, '[^A-Za-z0-9 ]', '', 'g')))"
];

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Dates in the file are MM/DD/YYYY; store as date, null on empty or malformed.
function parseDate(v) {
  const s = clean(v);
  if (s === null) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// A UTF-8 BOM on the first header cell would make the NPI column unfindable.
const stripBom = s => s.replace(/^﻿/, '');

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

function buildHeaderIndex(cols) {
  const idx = {};
  cols.forEach((h, i) => { idx[stripBom(h).trim()] = i; });
  return idx;
}

function resolveCreatedDateColumn(headerIndex) {
  for (const name of CREATED_DATE_NAMES) {
    if (headerIndex[name] !== undefined) return name;
  }
  return null;
}

function mapRow(fields, headerIndex, createdDateCol, source, asOf) {
  const o = {};
  for (const [key, name] of Object.entries(COLS)) {
    o[key] = clean(fields[headerIndex[name]]);
  }
  o.created_date = createdDateCol ? parseDate(fields[headerIndex[createdDateCol]]) : null;
  o.source = source;
  o.as_of = asOf;
  return o;
}

function parseArgs(argv) {
  const args = { file: null, limit: null, source: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--source') args.source = argv[++i];
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (!args.file) {
    console.error('Usage: node tools/nppes-othername-ingest.js --file <csv> [--limit n] [--source label]');
    process.exit(1);
  }
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
  let createdDateCol = null;
  let parsed = 0;
  let inQ = false, field = '', rec = [];
  let batch = [];
  let inserted = 0;
  let stopped = false;

  async function flush() {
    if (!batch.length) return;
    const items = batch;
    batch = [];
    await c.query(
      'INSERT INTO nppes_othernames SELECT * FROM jsonb_populate_recordset(null::nppes_othernames, $1::jsonb)',
      [JSON.stringify(items)]
    );
    inserted += items.length;
    if (inserted % 100000 === 0) console.log(`  ${inserted} inserted...`);
  }

  async function handleRecord(cols) {
    if (!headerIndex) {
      headerIndex = buildHeaderIndex(cols);
      if (headerIndex[COLS.npi] === undefined) {
        throw new Error(`header has no ${COLS.npi} column (first cell: ${JSON.stringify(cols[0])})`);
      }
      createdDateCol = resolveCreatedDateColumn(headerIndex);
      if (!createdDateCol) console.log('note: no created-date column in this header; created_date will be null');
      return;
    }
    if (args.limit !== null && parsed >= args.limit) { stopped = true; return; }
    parsed++;
    batch.push(mapRow(cols, headerIndex, createdDateCol, args.source, AS_OF));
    if (batch.length >= 1000) await flush();
  }

  (async () => {
    await c.connect();
    await c.query(DDL);
    await c.query('TRUNCATE nppes_othernames');
    console.log('table truncated, streaming CSV...');

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

    for (const sql of INDEXES) await c.query(sql);

    const r = await c.query('SELECT COUNT(*) AS total FROM nppes_othernames');
    const table = parseInt(r.rows[0].total, 10);
    if (parsed !== inserted || inserted !== table) {
      console.error(`INGEST_FAILED parsed=${parsed} inserted=${inserted} table=${table}`);
      process.exit(1);
    }
    const dba = await c.query("SELECT COUNT(*) AS n FROM nppes_othernames WHERE other_name_type_code = '3'");
    console.log(`INGEST_OK parsed=${parsed} inserted=${inserted} table=${table} dba=${dba.rows[0].n}`);
    await c.end();
  })().catch(e => { console.error('INGEST_FAILED:', e.message); process.exit(1); });
}

module.exports = {
  parseLine, parseDate, stripBom, buildHeaderIndex, resolveCreatedDateColumn, mapRow, COLS
};

if (require.main === module) { main(); }
