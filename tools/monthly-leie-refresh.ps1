# monthly-leie-refresh.ps1 v3: direct-URL LEIE refresh, scrape only as fallback.
# OIG publishes the current full LEIE at a stable path, overwritten monthly.

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\leie-refresh.log"
$ua      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }

Log '=== monthly LEIE refresh started ==='

$url = $null
# 1. direct stable URL first (proven 2026-09-12)
$direct = 'https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv'
try {
    $h = Invoke-WebRequest -Uri $direct -Method Head -UserAgent $ua -UseBasicParsing -TimeoutSec 30
    if ([int64]$h.Headers.'Content-Length' -gt 1MB) { $url = $direct; Log "direct URL alive: $direct ($([math]::Round($h.Headers.'Content-Length'/1MB,1)) MB)" }
} catch { Log "direct URL check failed: $($_.Exception.Message)" }

# 2. fallback: scrape the downloads page for any leie csv/zip
if (-not $url) {
    try {
        $page = (Invoke-WebRequest -Uri 'https://oig.hhs.gov/exclusions/leie-database-supplement-downloads/' -UserAgent $ua -UseBasicParsing -TimeoutSec 60).Content
        $links = [regex]::Matches($page, 'href="([^"]*\.(?:zip|csv)[^"]*)"', 'IgnoreCase') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
        $pick = ($links | Where-Object { $_ -match 'leie' } | Select-Object -First 1)
        if (-not $pick) { $pick = ($links | Select-Object -First 1) }
        if ($pick) {
            $url = if ($pick -match '^http') { $pick } else { "https://oig.hhs.gov$pick" }
            Log "scraped fallback URL: $url"
        }
    } catch { Log "scrape fallback failed: $($_.Exception.Message)" }
}

if (-not $url) { Log 'WARN: no LEIE source reachable; keeping existing file'; exit 0 }

# 3. download (skip if same filename exists from today)
$name = ($url -split '/')[-1]
$dest = "$project\data\leie\$name"
$destZip = $dest -replace '\.csv$','.zip'
if ((Test-Path $dest) -and (Get-ChildItem $dest).LastWriteTime -gt (Get-Date).AddHours(-20)) {
    Log "$name already downloaded today; skipping to ingest"
} elseif ((Test-Path $destZip) -and (Get-ChildItem $destZip).LastWriteTime -gt (Get-Date).AddHours(-20)) {
    Log "zip already downloaded today; skipping to ingest"
} else {
    Log "downloading $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UserAgent $ua -TimeoutSec 900 -UseBasicParsing
        if ($dest -match '\.zip$') { Expand-Archive -Path $dest -DestinationPath "$project\data\leie" -Force; Log 'zip extracted' }
        Log "download complete: $name"
    } catch {
        Log "WARN download failed: $($_.Exception.Message); keeping existing file"
        exit 0
    }
}

# 4. reload into Postgres (self-verifying, truncates first)
powershell -ExecutionPolicy Bypass -File "$project\tools\leie-ingest.ps1"
Log '=== monthly LEIE refresh finished ==='
