# nppes-full-download.ps1 v4: direct monthly V.2 download, no scraping.
# Derives the current and previous month filenames, HEAD-verifies, downloads the match.

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\nppes-download.log"
$destDir = "$project\data\nppes"
$ua      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }

$drive = (Get-PSDrive C).Free / 1GB
Log "C: free space: $([math]::Round($drive,1)) GB"
if ($drive -lt 30) { Log 'WARN: less than 30 GB free; aborting.'; exit 1 }
New-Item -ItemType Directory -Path $destDir -Force | Out-Null

# build candidate month names: this month first, then last month
$now = Get-Date
$monthNames = [System.Globalization.CultureInfo]::InvariantCulture.DateTimeFormat.MonthNames
$candidates = @()
foreach ($d in @($now, $now.AddMonths(-1))) {
    $candidates += "NPPES_Data_Dissemination_$($monthNames[$d.Month - 1])_$($d.Year)_V2.zip"
}

$url = $null; $expectedBytes = $null
foreach ($f in $candidates) {
    $u = "https://download.cms.gov/nppes/$f"
    try {
        $h = Invoke-WebRequest -Uri $u -Method Head -UserAgent $ua -UseBasicParsing -TimeoutSec 30
        if ([int64]$h.Headers.'Content-Length' -gt 500MB) {
            $url = $u
            $expectedBytes = [int64]$h.Headers.'Content-Length'
            Log "found monthly file: $f ($([math]::Round($expectedBytes/1MB,1)) MB)"
            break
        } else {
            Log "candidate too small, skipping: $f"
        }
    } catch {
        Log "not found: $f"
    }
}
if (-not $url) { Log 'FATAL: no monthly V2 file found; check https://download.cms.gov/nppes/NPI_Files.html manually'; exit 1 }

$dest = Join-Path $destDir ($url -split '/')[-1]
if (Test-Path $dest) { Log "file already exists at $dest; skipping download" }
else {
    Log "downloading $url ..."
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UserAgent $ua -TimeoutSec 7200 -UseBasicParsing
        $actual = (Get-Item $dest).Length
        Log "download complete: $([math]::Round($actual/1MB,1)) MB in $([math]::Round($sw.Elapsed.TotalMinutes,1)) minutes"
        if ([math]::Abs($actual - $expectedBytes) -gt 5MB) {
            Log 'WARN: size differs from expected by more than 5 MB; consider redownloading'
        }
    } catch {
        Log "WARN download failed: $($_.Exception.Message)"
        exit 1
    }
}
Log 'zip left unextracted; extraction happens when the V.2 ingest pipeline is built'
Log 'NOTE: NPPES Version 2 layout (extended field lengths), effective 03/03/2026'
Log '=== nppes download script finished ==='
