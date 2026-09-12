# leie-ingest.ps1 v2: direct CSV-to-Postgres loader for the OIG LEIE file.
# Parses the CSV in Node (quote-aware state machine), streams batches into oig_exclusions.
# TRUNCATES the table first: safe to re-run. Verifies parsed == inserted == table count.

$ErrorActionPreference = 'Stop'
$project = 'C:\Users\casalab\provider-intelligence'
Set-Location $project

$csv = Get-ChildItem "$project\data\leie" -Filter *.csv | Select-Object -First 1
if (-not $csv) { Write-Host 'No LEIE csv found in data\leie'; exit 1 }
Write-Host "Source file: $($csv.Name)"

$js = @'
const fs = require('fs');
const { Client } = require('pg');

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2];
}

const CSV_PATH = process.argv[2];
const SOURCE   = process.argv[3];
const AS_OF    = new Date().toISOString().slice(0, 10);
const COLS = ['lastname','firstname','midname','busname','general','specialty','upin','npi','dob','address','city','state','zip','excltype','excldate','reindate','waiverdate','wvrstate'];

const c = new Client({
  host: env.DB_HOST || 'localhost',
  port: parseInt(env.DB_PORT || '5432', 10),
  database: env.DB_NAME || 'provider_intelligence',
  user: env.DB_USER || 'admin',
  password: env.DB_PASSWORD
});

let parsed = 0;
let headerSkipped = false;
let inQ = false, field = '', rec = [];
let batch = [];
let inserted = 0;

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '00000000') return null;
  return s;
};

function toRow(cols) {
  const o = {};
  for (let i = 0; i < COLS.length; i++) o[COLS[i]] = clean(cols[i]);
  if (o.npi === '0000000000') o.npi = null;
  o.source = SOURCE;
  o.as_of = AS_OF;
  o.display_name = o.busname || [o.lastname, o.firstname].filter(Boolean).join(', ') || null;
  return o;
}

function flush() {
  if (!batch.length) return Promise.resolve();
  const items = batch;          // snapshot before async boundary
  batch = [];
  return c.query(
    'INSERT INTO oig_exclusions SELECT * FROM jsonb_populate_recordset(null::oig_exclusions, $1::jsonb)',
    [JSON.stringify(items)]
  ).then(() => {
    inserted += items.length;
    if (inserted % 10000 === 0) console.log(`  ${inserted} inserted...`);
  });
}

function handleRecord(cols) {
  if (!headerSkipped) { headerSkipped = true; return Promise.resolve(); }
  parsed++;
  batch.push(toRow(cols));
  if (batch.length >= 500) return flush();
  return Promise.resolve();
}

(async () => {
  await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS oig_exclusions (
    lastname text, firstname text, midname text, busname text,
    general text, specialty text, upin text, npi text, dob text,
    address text, city text, state text, zip text,
    excltype text, excldate text, reindate text,
    waiverdate text, wvrstate text,
    source text, as_of date, display_name text
  )`);
  await c.query('ALTER TABLE oig_exclusions ADD COLUMN IF NOT EXISTS display_name text');
  await c.query('TRUNCATE oig_exclusions');
  console.log('table truncated, streaming CSV...');

  let chain = Promise.resolve();
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(CSV_PATH);
    stream.on('data', chunk => {
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
        else if (ch === '\n') { rec.push(field); field = ''; const r = rec; rec = []; chain = chain.then(() => handleRecord(r)); }
        else if (ch === '\r') { /* skip */ }
        else field += ch;
      }
    });
    stream.on('end', () => {
      chain = chain.then(async () => {
        if (field.length || rec.length) { rec.push(field); await handleRecord(rec); }
        await flush();
      });
      chain.then(resolve, reject);
    });
    stream.on('error', reject);
  });

  const r = await c.query(`SELECT COUNT(*) AS total,
    COUNT(*) FILTER (WHERE npi IS NOT NULL) AS real_npi,
    COUNT(DISTINCT display_name) AS distinct_names
    FROM oig_exclusions`);
  const t = r.rows[0];
  console.log(`PARSED=${parsed} INSERTED=${inserted} TABLE=${t.total} REAL_NPI=${t.real_npi} DISTINCT_NAMES=${t.distinct_names}`);
  if (String(parsed) !== t.total || String(inserted) !== t.total) {
    console.error('INGEST_FAILED: parsed/inserted/table counts do not match');
    process.exit(1);
  }
  console.log('INGEST_OK');
  await c.end();
})().catch(e => { console.error('INGEST_FAILED:', e.message); process.exit(1); });
'@

$jsTmp = "$project\data\leie\leie-ingest.tmp.js"
Set-Content $jsTmp $js
try { node $jsTmp $csv.FullName $csv.Name } finally { Remove-Item $jsTmp -Force }
Write-Host 'Cleanup done.'
