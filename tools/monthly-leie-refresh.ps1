# monthly-leie-refresh.ps1: re-download the OIG LEIE and reload it.
# Safe to re-run: the ingest truncates first. Logs to logs/leie-refresh.log.

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\leie-refresh.log"
$ua      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }

Log '=== monthly LEIE refresh started ==='

# 1. find and download the current LEIE file
try {
    $page = (Invoke-WebRequest -Uri 'https://oig.hhs.gov/exclusions/downloadables/' -UserAgent $ua -UseBasicParsing -TimeoutSec 60).Content
    $links = [regex]::Matches($page, 'href="([^"]*\.(?:zip|csv))"', 'IgnoreCase') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    $pick = ($links | Where-Object { $_ -match 'leie' -and $_ -match 'updated' } | Select-Object -First 1)
    if (-not $pick) { $pick = ($links | Where-Object { $_ -match 'leie' } | Select-Object -First 1) }
    if (-not $pick) { Log 'WARN: no LEIE link found; keeping existing file'; exit 0 }
    $url  = if ($pick -match '^http') { $pick } else { "https://oig.hhs.gov$pick" }
    $dest = "$project\data\leie\" + (($url -split '/')[-1])
    Log "downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UserAgent $ua -TimeoutSec 900 -UseBasicParsing
    if ($dest -match '\.zip$') { Expand-Archive -Path $dest -DestinationPath "$project\data\leie" -Force; Log 'zip extracted' }
    Log 'download complete'
} catch {
    Log "WARN download failed: $($_.Exception.Message); keeping existing file"
    exit 0
}

# 2. reload into Postgres (the ingest self-verifies and truncates first)
powershell -ExecutionPolicy Bypass -File "$project\tools\leie-ingest.ps1"
Log '=== monthly LEIE refresh finished ==='
