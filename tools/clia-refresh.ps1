# clia-refresh.ps1: quarterly refresh of the CLIA laboratory registry.
#
# Discovers the newest CMS POS Clinical Laboratories CSV from the data.gov
# catalog page (the download URL changes every quarter), downloads it,
# runs tools/clia-ingest.js, and no-ops cleanly when no newer vintage
# exists yet (CMS publishes roughly two months after quarter end).
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\clia-refresh.ps1 [-Force]

param([switch]$Force)

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\clia-refresh.log"
$ua      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }

Log '=== clia refresh started ==='

# Find the newest Clia_DATA.Qn_YYYY.csv download URL in the catalog page.
$url = $null; $vintage = $null
try {
  $page = (Invoke-WebRequest -Uri 'https://catalog.data.gov/dataset/provider-of-services-file-clinical-laboratories' -UserAgent $ua -UseBasicParsing -TimeoutSec 120).Content
  $matches = [regex]::Matches($page, 'https://data\.cms\.gov/sites/default/files/[^"]*Clia_DATA\.Q(\d)_(\d{4})\.csv')
  $best = $null; $bestKey = 0
  foreach ($mm in $matches) {
    $key = [int]$mm.Groups[2].Value * 10 + [int]$mm.Groups[1].Value
    if ($key -gt $bestKey) { $bestKey = $key; $best = $mm.Value; $vintage = "Clia_DATA.Q$($mm.Groups[1].Value)_$($mm.Groups[2].Value)" }
  }
  if ($best) { $url = $best }
} catch { Log "WARN catalog fetch failed: $($_.Exception.Message)" }

if (-not $url) { Log 'WARN no Clia_DATA CSV found in catalog; nothing to do'; exit 0 }
Log "newest vintage: $vintage"

# Skip if this vintage is already loaded (unless -Force).
$check = node -e "const fs=require('fs');const env={};for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);if(m)env[m[1]]=m[2]}const{Client}=require('pg');const c=new Client({host:'localhost',port:5432,database:'provider_intelligence',user:'admin',password:env.DB_PASSWORD});c.connect().then(async()=>{const r=await c.query(\"SELECT COUNT(*)::int n FROM clia_labs WHERE data_source='\" + process.argv[1] + \"'\");console.log(r.rows[0].n);await c.end()}).catch(e=>{console.error(e.message);process.exit(1)})" $vintage 2>$null
if ($LASTEXITCODE -eq 0 -and $check -match '^\d+$' -and [int]$check -gt 0) {
  Log "vintage $vintage already loaded ($check rows); nothing to do (use -Force to re-ingest)"
  exit 0
}

$csv = "tmp\$vintage.csv"
try {
  Invoke-WebRequest -Uri $url -OutFile $csv -UserAgent $ua -TimeoutSec 900 -UseBasicParsing
  Log "downloaded $csv ($([math]::Round((Get-Item $csv).Length/1MB,1)) MB)"
} catch { Log "WARN download failed: $($_.Exception.Message)"; exit 1 }

node tools/clia-ingest.js $csv
if ($LASTEXITCODE -ne 0) { Log 'WARN clia-ingest failed'; exit 1 }

Remove-Item $csv -Force -ErrorAction SilentlyContinue
Log '=== clia refresh finished ==='
