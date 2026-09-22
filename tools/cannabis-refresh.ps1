# cannabis-refresh.ps1: weekly FL OMMU Qualified Physician List refresh.
# The list page links the current PDF as /wp-content/uploads/_documents/QP_List/MMDDYY.pdf.
# Download -> pdftotext -layout -> lossless re-ingest (npi + NPI-match notes
# survive, see tools/cannabis-ingest.js) -> drop licenses absent from the new
# list (the table mirrors the current list) -> NPI-enrich genuinely new rows.
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\cannabis-refresh.ps1 [-Force]

param([switch]$Force)

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\cannabis-refresh.log"
$ua      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }

# Self-contained DB access (parses .env in-process, never prints it), same
# pattern as tools/update-local-db.ps1. The node helpers are written out as
# temp .js files because PowerShell mangles embedded quotes/$-placeholders in
# node -e one-liners. The SQL in argv[1] must not contain $-placeholders.
$DbJsPath  = "$project\tmp\cannabis-refresh-db.js"
$DropJsPath = "$project\tmp\cannabis-refresh-drop.js"
@'
const { Client } = require('pg');
const fs = require('fs');
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const c = new Client({
  host: 'localhost', port: 5432, database: 'provider_intelligence',
  user: 'admin', password: env.DB_PASSWORD
});
c.connect().then(async () => {
  const r = await c.query(process.argv[2]);
  console.log(JSON.stringify(r.rows));
  await c.end();
}).catch(err => { console.error('DB FAILED:', err.message); process.exit(1); });
'@ | Set-Content -Path $DbJsPath -Encoding ASCII

@'
// Drops cannabis_certifications rows for the FL OMMU source whose license is
// absent from the freshly parsed list, and prints "count lic1 lic2 ..." so
// the caller never has to JSON-parse an array from PowerShell 5.1.
const { Client } = require('pg');
const fs = require('fs');
const { parseQpList } = require('../tools/cannabis-ingest.js');
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const c = new Client({
  host: 'localhost', port: 5432, database: 'provider_intelligence',
  user: 'admin', password: env.DB_PASSWORD
});
c.connect().then(async () => {
  const { rows } = parseQpList(fs.readFileSync(process.argv[2], 'utf8'));
  const licenses = [...new Set(rows.map(r => r.license))];
  const r = await c.query(
    `DELETE FROM cannabis_certifications
      WHERE state = $1 AND source_name = $2 AND license_number <> ALL($3)
      RETURNING license_number`,
    ['FL', 'FL OMMU Qualified Physician List', licenses]
  );
  const dropped = r.rows.map(x => x.license_number);
  console.log(`${dropped.length}${dropped.length ? ' ' + dropped.join(' ') : ''}`);
  await c.end();
}).catch(err => { console.error('DROP FAILED:', err.message); process.exit(1); });
'@ | Set-Content -Path $DropJsPath -Encoding ASCII

function DbJson($sql){ return (node $DbJsPath $sql) | ConvertFrom-Json }

Log '=== cannabis refresh started ==='

# 1. list page -> current QP_List PDF href
try {
    $page = (Invoke-WebRequest -Uri 'https://knowthefactsmmj.com/physicians/list/' -UserAgent $ua -UseBasicParsing -TimeoutSec 60).Content
} catch {
    Log "WARN list page fetch failed: $($_.Exception.Message); keeping existing data"
    exit 0
}
$m = [regex]::Match($page, 'href="([^"]*QP_List/(\d{6})\.pdf)"', 'IgnoreCase')
if (-not $m.Success) { Log 'WARN no QP_List pdf href on list page; keeping existing data'; exit 0 }
$href = $m.Groups[1].Value
$yy = $m.Groups[2].Value
$asOf = "20$($yy.Substring(4,2))-$($yy.Substring(0,2))-$($yy.Substring(2,2))"
$url = if ($href -match '^http') { $href } else { "https://knowthefactsmmj.com$href" }
Log "list page href: $url (as_of $asOf)"

# 2. already-current check
$before = DbJson "SELECT COUNT(*)::int n, COUNT(npi)::int with_npi, MAX(as_of::text) m FROM cannabis_certifications WHERE state = 'FL' AND source_name = 'FL OMMU Qualified Physician List'"
if (-not $before) { Log 'ERROR could not read cannabis_certifications; aborting'; exit 1 }
Log "table before: rows=$($before.n) with_npi=$($before.with_npi) max_as_of=$($before.m)"
if (-not $Force -and $before.m -eq $asOf) { Log "already current ($asOf); nothing to do"; exit 0 }

# 3. download + parse + ingest
$pdf = "$project\tmp\qp-$asOf.pdf"
$txt = "$project\tmp\qp-$asOf.txt"
Log "downloading $url"
try {
    Invoke-WebRequest -Uri $url -OutFile $pdf -UserAgent $ua -TimeoutSec 300 -UseBasicParsing
} catch {
    Log "WARN download failed: $($_.Exception.Message); keeping existing data"
    exit 0
}
& pdftotext -layout $pdf $txt
if ($LASTEXITCODE -ne 0) { Log "WARN pdftotext failed ($LASTEXITCODE); keeping existing data"; exit 0 }

# Cross-check the "List Updated" line against the filename date.
$lu = (Select-String -Path $txt -Pattern 'List Updated ([A-Za-z]+ \d{1,2}, \d{4})' | Select-Object -First 1).Matches.Groups[1].Value
$luIso = (Get-Date $lu).ToString('yyyy-MM-dd')
Log "parsed 'List Updated' line: $lu ($luIso)"
if ($luIso -ne $asOf) { Log "WARN filename as_of $asOf does not match 'List Updated' line ($luIso); ingest uses the in-file date" }

node tools/cannabis-ingest.js $txt
if ($LASTEXITCODE -ne 0) { Log 'ERROR ingest failed; aborting before drop step to avoid deleting against a bad file'; exit 1 }

# 4. drop table rows for this source whose license is absent from the new file
$dropOut = node $DropJsPath $txt
if ($LASTEXITCODE -ne 0) { Log 'ERROR drop step failed'; exit 1 }
$dropParts = @($dropOut -split ' ')
$droppedCount = [int]$dropParts[0]
$droppedLicenses = @($dropParts | Select-Object -Skip 1)
Log "dropped $droppedCount rows absent from new list: $($droppedLicenses -join ', ')"

# 5. NPI-enrich genuinely new rows (existing npi survive the ingest untouched)
node tools/cannabis-npi-enrich.js
if ($LASTEXITCODE -ne 0) { Log 'WARN enrich failed; table is otherwise refreshed' }

# 6. summary
$after = DbJson "SELECT COUNT(*)::int n, COUNT(npi)::int with_npi FROM cannabis_certifications WHERE state = 'FL' AND source_name = 'FL OMMU Qualified Physician List'"
$union = DbJson "SELECT COUNT(*)::int n FROM (SELECT DISTINCT pl.npi FROM provider_licenses pl JOIN cannabis_certifications cc ON cc.license_number = pl.license_number AND cc.state = pl.issuing_state UNION SELECT p.npi FROM providers p JOIN cannabis_certifications cc ON cc.license_number = p.license_number AND cc.state = p.license_issuing_state UNION SELECT npi FROM cannabis_certifications WHERE npi IS NOT NULL) u"
Log "SUMMARY as_of=$asOf upserted=$($after.n) dropped=$droppedCount npi_filled=$($after.with_npi - $before.with_npi) with_npi=$($after.with_npi) union_matches=$($union.n)"
Log '=== cannabis refresh finished ==='

Remove-Item $DbJsPath, $DropJsPath -Force -ErrorAction SilentlyContinue
