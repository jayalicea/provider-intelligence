# cannabis-refresh-all.ps1: weekly full-pipeline refresh for every state.
#
#   FL -> delegates to tools/cannabis-refresh.ps1 (downloads the current
#         weekly OMMU PDF, re-ingests, runs the whole pipeline)
#   PA -> downloads the PA DOH Approved Practitioners PDF (stable URL),
#         pdftotext, ingest -> nppes-match -> nppes-resolve
#   WV -> downloads the WV OMC physicians PDF (stable URL), same pipeline
#   AL -> the AMCC URL is date-stamped and needs a manual tmp/ update; the
#         pipeline still runs on the existing tmp/al-physicians.txt so
#         matches improve even when the source is unchanged
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\cannabis-refresh-all.ps1

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\cannabis-refresh-all.log"
$ua      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }

function Get-Source($url, $pdf, $txt) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $pdf -UserAgent $ua -TimeoutSec 300 -UseBasicParsing
    if ((Get-Item $pdf).Length -lt 10kb) { Log "WARN $pdf suspiciously small; keeping previous text"; return $false }
    & pdftotext -layout $pdf $txt
    return $LASTEXITCODE -eq 0
  } catch {
    Log "WARN download failed ${url}: $($_.Exception.Message); using existing $txt"
    return Test-Path $txt
  }
}

Log '=== cannabis refresh-all started ==='

# FL (own script: download + ingest + drop + enrich + nppes steps)
Log '--- FL (weekly OMMU refresh) ---'
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cannabis-refresh.ps1

# PA
Log '--- PA ---'
if (Get-Source 'https://www.pa.gov/content/dam/copapwp-pagov/en/health/documents/topics/documents/programs/medical-marijuana/DOH%20Approved%20Practitioners.pdf' 'tmp\pa-practitioners.pdf' 'tmp\pa-practitioners.txt') {
  node tools\cannabis-ingest-pa.js
  node tools\cannabis-nppes-match.js --state PA
  node tools\cannabis-nppes-resolve.js --state PA
} else { Log 'WARN PA skipped (no source text)' }

# WV
Log '--- WV ---'
if (Get-Source 'https://omc.wv.gov/patients/schedule-an-appointment/Documents/PHYSICIANS%20LIST%20-%20UPDATED.pdf' 'tmp\wv-physicians.pdf' 'tmp\wv-physicians.txt') {
  node tools\cannabis-ingest-wv.js
  node tools\cannabis-nppes-match.js --state WV
  node tools\cannabis-nppes-resolve.js --state WV
} else { Log 'WARN WV skipped (no source text)' }

# AL (the AMCC PDF URL is date-stamped; discover the current link from the
# patients page, then run the pipeline)
Log '--- AL ---'
$alHref = $null
try {
  $alPage = (Invoke-WebRequest -Uri 'https://amcc.alabama.gov/patients/' -UserAgent $ua -UseBasicParsing -TimeoutSec 60).Content
  $m = [regex]::Match($alPage, 'href="([^"]*Certifying-Physicians[^"]*\.pdf)"')
  if ($m.Success) { $alHref = $m.Groups[1].Value }
} catch { Log "WARN AMCC page fetch failed: $($_.Exception.Message)" }
if ($alHref -and (Get-Source $alHref 'tmp\al-physicians.pdf' 'tmp\al-physicians.txt')) {
  node tools\cannabis-ingest-al.js
  node tools\cannabis-nppes-match.js --state AL
  node tools\cannabis-nppes-resolve.js --state AL
} elseif (Test-Path 'tmp\al-physicians.txt') {
  Log 'AL download failed; running pipeline on the existing source text'
  node tools\cannabis-ingest-al.js
  node tools\cannabis-nppes-match.js --state AL
  node tools\cannabis-nppes-resolve.js --state AL
} else { Log 'WARN AL skipped (no source text)' }

Log '=== cannabis refresh-all finished ==='
