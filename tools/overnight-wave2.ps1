# overnight-wave2.ps1 v2: parallel overnight downloads (fixed URLs + process-based gate).
# Phase 1: OIG LEIE exclusions CSV (oig.hhs.gov).
# Phase 2: Care Compare hospital quality pre-cache, first 600 hospitals (datastore query API).
# Phase 3: waits until no MIPS seed process is running, then MIPS wave 2 (8 states).
# Run in its OWN window. Leave OPEN until morning.

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\wave2.log"
$apiBase = 'http://localhost:3000/api/v1'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }
function Jitter($a,$b){ Start-Sleep -Milliseconds (Get-Random -Minimum $a -Maximum $b) }
function Unwrap-Rows($resp){
  if ($null -eq $resp) { return @() }
  if ($resp -is [array]) { return $resp }
  if ($resp.results) { return @($resp.results) }
  if ($resp.data)    { return @($resp.data) }
  return @($resp)
}
function Get-StoreRows($id, $limit, $offset){
  try {
    return @(Unwrap-Rows (Invoke-RestMethod -Uri "https://data.cms.gov/provider-data/api/1/datastore/query/$id/0" -Body @{ limit = $limit; offset = $offset } -Method Get -TimeoutSec 60))
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Log "WARN datastore $id offset $offset : HTTP $code $($_.Exception.Message)"
    return @()
  }
}
function Test-SeedRunning {
  $hits = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
          Where-Object { $_.CommandLine -match 'overnight-mips-seed' }
  return [bool]$hits
}

Log '=== wave2 overnight v2 started ==='

# ---------------------------------------------------------------------------
# PHASE 1: OIG LEIE full database CSV
# ---------------------------------------------------------------------------
Log '--- PHASE 1: LEIE download ---'
try {
    $pageUrl = 'https://oig.hhs.gov/exclusions/leie-database-supplement-downloads/'
    $page = (Invoke-WebRequest -Uri $pageUrl -UseBasicParsing -TimeoutSec 60).Content
    $all = [regex]::Matches($page, 'href="([^"]*\.(?:zip|csv))"', 'IgnoreCase') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    # rank: prefer the full monthly database over supplement files
    $pick = ($all | Where-Object { $_ -match 'leie' -and $_ -match 'updated' } | Select-Object -First 1)
    if (-not $pick) { $pick = ($all | Where-Object { $_ -match 'leie' } | Select-Object -First 1) }
    if (-not $pick) { $pick = ($all | Select-Object -First 1) }
    if (-not $pick) { Log 'WARN: no LEIE link found on page; download manually tomorrow' }
    else {
        $url  = if ($pick -match '^http') { $pick } else { "https://oig.hhs.gov$pick" }
        $name = ($url -split '/')[-1]
        $destDir = "$project\data\leie"
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        $dest = Join-Path $destDir $name
        Log "downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 900
        $sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)
        Log "saved $dest ($sizeMB MB)"
        if ($dest -match '\.zip$') { Expand-Archive -Path $dest -DestinationPath $destDir -Force; Log 'zip extracted' }
        $csv = Get-ChildItem $destDir -Filter *.csv | Select-Object -First 1
        if ($csv) { Log "CSV header: $((Get-Content $csv.FullName -TotalCount 1))" }
    }
} catch {
    Log "WARN phase 1 failed: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# PHASE 2: hospital quality pre-cache via the provider-data datastore API
# ---------------------------------------------------------------------------
Log '--- PHASE 2: hospital quality pre-cache ---'
$genInfo = 'xubh-q36u'
try {
    $probe = Get-StoreRows $genInfo 1 0
    if ($probe.Count -eq 0) { Log 'WARN: general-info probe empty; skipping phase 2' }
    else {
        $cols = $probe[0].PSObject.Properties.Name
        $facCol = $cols | Where-Object { $_ -match 'facility.*id|ccn' } | Select-Object -First 1
        Log "facility column: '$facCol'"
        if (-not $facCol) { Log 'WARN: no facility id column; skipping phase 2' }
        else {
            $facs = New-Object System.Collections.Generic.List[string]
            for ($off = 0; $off -lt 600 -and $facs.Count -lt 600; $off += 200) {
                $rows = Get-StoreRows $genInfo 200 $off
                if ($rows.Count -eq 0) { break }
                foreach ($r in $rows) {
                    $f = "$($r.$facCol)".Trim().TrimStart("'")
                    if ($f -match '^\d{6}$' -and -not $facs.Contains($f)) { $facs.Add($f) }
                }
                Jitter 1500 3000
            }
            Log "$($facs.Count) facility IDs collected; caching quality measures"
            $n = 0
            foreach ($f in $facs) {
                $n++
                Write-Host "`rquality cache $n of $($facs.Count)" -NoNewline
                curl.exe -s "$apiBase/providers/quality-measures/$f" | Out-Null
                Jitter 2000 4500
            }
            Write-Host ''
            Log "phase 2 complete: $($facs.Count) facilities requested"
        }
    }
} catch {
    Log "WARN phase 2 failed: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# PHASE 3: MIPS wave 2, gated on NO seed process running (process detection)
# ---------------------------------------------------------------------------
Log '--- PHASE 3: waiting for MIPS run 1 to finish ---'
$waited = 0
while ($waited -lt 360) {
    if (-not (Test-SeedRunning)) {
        # confirm twice, 90s apart, so we do not catch a process mid-restart
        Start-Sleep -Seconds 90
        if (-not (Test-SeedRunning)) { Log 'no seed process running; starting MIPS wave 2'; break }
    }
    Start-Sleep -Seconds 60
    $waited++
    if ($waited % 15 -eq 0) { Log "still waiting for run 1 ($waited min)" }
}
if ($waited -ge 360) {
    Log 'WARN: waited 6h; skipping wave 2 to avoid doubling upstream load'
} else {
    $wave2States = 'GA','NJ','WA','AZ','MA','CO','MI','NC'
    Log "launching v5 with states: $($wave2States -join ',')"
    & powershell -ExecutionPolicy Bypass -File "$project\tools\overnight-mips-seed.ps1" -States $wave2States -PerState 400
    Log 'wave 2 launcher returned'
}

Log '=== wave2 overnight v2 complete ==='
Write-Host ''
Write-Host 'DONE. This window can be closed.'
