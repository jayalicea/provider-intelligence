# state-exclusions-ingest.ps1: repair and load the Swarm state-exclusion CSV.
# Repairs the swarm's column misalignment (date in exclusion_type), dedupes within the
# dataset, flags LEIE overlap, loads into state_exclusions with provenance.
# TRUNCATE-first: safe to re-run. Self-verifies counts.

$ErrorActionPreference = 'Stop'
$project = 'C:\Users\casalab\provider-intelligence'
Set-Location $project

$csvPath = "$project\data\exclusions\state-medicaid-exclusions.csv"
if (-not (Test-Path $csvPath)) { Write-Host "CSV not found: $csvPath"; exit 1 }
Write-Host "Source: $csvPath"

# Stream CSV -> NDJSON (PowerShell handles quoting; repair happens in the JS loader)
$tmp = "$project\data\exclusions\state-exclusions.ndjson"
Write-Host 'Converting CSV to NDJSON...'
Import-Csv $csvPath | ForEach-Object {
    [pscustomobject]@{
        state                        = $_.state
        source_name                  = $_.source_name
        source_url                   = $_.source_url
        entity_name                  = $_.entity_name
        npi                          = $_.npi
        exclusion_type               = $_.exclusion_type
        exclusion_date               = $_.exclusion_date
        reinstatement_date           = $_.reinstatement_date
        as_of                        = $_.as_of
        retrieval_method             = $_.retrieval_method
        provenance_note              = $_.provenance_note
        suspected_leie_republication = $_.suspected_leie_republication
    } | ConvertTo-Json -Compress
} | Set-Content $tmp -Encoding UTF8
Write-Host "NDJSON written: $((Get-Item $tmp).Length / 1MB) MB"

$js = @'
const fs = require('fs');
const readline = require('readline');
const { Client } = require('pg');

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2];
}

const NDJSON = process.argv[2];
const c = new Client({
  host: env.DB_HOST || 'localhost',
  port: parseInt(env.DB_PORT || '5432', 10),
  database: env.DB_NAME || 'provider_intelligence',
  user: env.DB_USER || 'admin',
  password: env.DB_PASSWORD
});

let parsed = 0, inserted = 0, skippedDupes = 0, repaired = 0;
const seen = new Set();
let batch = [];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clean = v => (v === null || v === undefined) ? null : (String(v).trim() === '' ? null : String(v).trim());

function toRow(o) {
  let exclusionType = clean(o.exclusion_type);
  let exclusionDate = clean(o.exclusion_date);
  // Repair swarm misalignment: ISO date sitting in exclusion_type
  if (!exclusionDate && exclusionType && DATE_RE.test(exclusionType)) {
    exclusionDate = exclusionType;
    exclusionType = null;
    repaired++;
  }
  const npi = clean(o.npi);
  return {
    state: clean(o.state),
    source_name: clean(o.source_name),
    source_url: clean(o.source_url),
    entity_name: clean(o.entity_name),
    npi: (npi && /^\d{10}$/.test(npi)) ? npi : null,
    exclusion_type: exclusionType,
    exclusion_date: exclusionDate,
    reinstatement_date: clean(o.reinstatement_date),
    as_of: clean(o.as_of),
    retrieval_method: clean(o.retrieval_method),
    provenance_note: clean(o.provenance_note),
    leie_overlap: false
  };
}

async function flush() {
  if (!batch.length) return;
  const items = batch; batch = [];
  await c.query(
    'INSERT INTO state_exclusions SELECT * FROM jsonb_populate_recordset(null::state_exclusions, $1::jsonb)',
    [JSON.stringify(items)]
  );
  inserted += items.length;
  if (inserted % 20000 === 0) console.log(`  ${inserted} inserted...`);
}

(async () => {
  await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS state_exclusions (
    state text, source_name text, source_url text, entity_name text,
    npi text, exclusion_type text, exclusion_date date, reinstatement_date date,
    as_of date, retrieval_method text, provenance_note text,
    leie_overlap boolean DEFAULT false
  )`);
  await c.query('ALTER TABLE state_exclusions ADD COLUMN IF NOT EXISTS leie_overlap boolean DEFAULT false');
  await c.query('TRUNCATE state_exclusions');
  await c.query('CREATE INDEX IF NOT EXISTS idx_state_excl_npi ON state_exclusions(npi)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_state_excl_state ON state_exclusions(state)');
  console.log('table ready, streaming...');

  const rl = readline.createInterface({ input: fs.createReadStream(NDJSON), crlfDelay: Infinity });
  for await (const line of rl) {
    const cleaned = line.replace(/^\uFEFF/, '');
    if (!cleaned.trim()) continue;
    parsed++;
    const row = toRow(JSON.parse(cleaned));
    const key = [row.state, (row.entity_name || '').toLowerCase(), row.exclusion_date || ''].join('|');
    if (seen.has(key)) { skippedDupes++; continue; }
    seen.add(key);
    batch.push(row);
    if (batch.length >= 1000) await flush();
  }
  await flush();

  // Flag LEIE overlap: NPI match or exact normalized entity-name match against LEIE display names
  const overlap = await c.query(`UPDATE state_exclusions s SET leie_overlap = true
    WHERE (s.npi IS NOT NULL AND s.npi IN (SELECT npi FROM oig_exclusions WHERE npi IS NOT NULL))
       OR lower(s.entity_name) IN (SELECT lower(display_name) FROM oig_exclusions WHERE display_name IS NOT NULL)`);
  console.log('leie_overlap rows flagged:', overlap.rowCount);

  const t = await c.query(`SELECT COUNT(*) AS total,
    COUNT(*) FILTER (WHERE npi IS NOT NULL) AS with_npi,
    COUNT(*) FILTER (WHERE leie_overlap) AS leie_overlap,
    COUNT(*) FILTER (WHERE exclusion_date IS NULL) AS missing_date,
    COUNT(DISTINCT state) AS states
    FROM state_exclusions`);
  const r = t.rows[0];
  console.log(`PARSED=${parsed} INSERTED=${inserted} DUPES_SKIPPED=${skippedDupes} REPAIRED=${repaired}`);
  console.log(`TABLE=${r.total} WITH_NPI=${r.with_npi} LEIE_OVERLAP=${r.leie_overlap} MISSING_DATE=${r.missing_date} STATES=${r.states}`);
  if (String(inserted) !== r.total) { console.error('INGEST_FAILED: inserted != table'); process.exit(1); }
  console.log('INGEST_OK');
  await c.end();
})().catch(e => { console.error('INGEST_FAILED:', e.message); process.exit(1); });
'@

$jsTmp = "$project\data\exclusions\state-exclusions-ingest.tmp.js"
Set-Content $jsTmp $js
try { node $jsTmp $tmp } finally { Remove-Item $jsTmp -Force }
Remove-Item $tmp -Force
Write-Host 'Cleanup done.'
