# overnight-wave2.ps1: parallel overnight downloads for provider-intelligence.
# Phase 1: OIG LEIE exclusions file (oig.hhs.gov, bulk download).
# Phase 2: Care Compare hospital quality pre-cache for the first 600 hospitals.
# Phase 3: waits for tonight's MIPS run to finish, then MIPS wave 2 (8 more states).
# Run this in its OWN window. Leave it OPEN until morning.

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\wave2.log"
$apiBase = 'http://localhost:3000/api/v1'
$seedLog = "$project\logs\mips-seed.log"
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }
function Jitter($a,$b){ Start-Sleep -Milliseconds (Get-Random -Minimum $a -Maximum $b) }
function Unwrap($resp){
  if ($null -eq $resp) { return @() }
  if ($resp -is [array]) { return $resp }
  if ($resp.data) { return @($resp.data) }
  return @($resp)
}

Log '=== wave2 overnight started ==='

# ---------------------------------------------------------------------------
# PHASE 1: OIG LEIE exclusions file
# ---------------------------------------------------------------------------
Log '--- PHASE 1: LEIE download ---'
try {
    $page = (Invoke-WebRequest -Uri 'https://oig.hhs.gov/exclusions/downloadables.asp' -UseBasicParsing -TimeoutSec 60).Content
    $links = [regex]::Matches($page, 'href="([^"]*(?:leie|excl)[^"]*\.(?:zip|csv))"', 'IgnoreCase') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    if (-not $links) { Log 'WARN: no LEIE download link found on the OIG page; download manually tomorrow' }
    foreach ($rel in $links) {
        $url = if ($rel -match '^http') { $rel } else { "https://oig.hhs.gov$rel" }
        $name = ($url -split '/')[-1]
        $destDir = "$project\data\leie"
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        $dest = Join-Path $destDir $name
        Log "downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 600
        $sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)
        Log "saved $dest ($sizeMB MB)"
        if ($dest -match '\.zip$') {
            Expand-Archive -Path $dest -DestinationPath $destDir -Force
            Log "extracted zip to $destDir"
        }
        # peek at the header so tomorrow's ingest knows the columns
        $csv = Get-ChildItem $destDir -Filter *.csv | Select-Object -First 1
        if ($csv) { Log "CSV header: $((Get-Content $csv.FullName -TotalCount 1))" }
        break
    }
} catch {
    Log "WARN phase 1 failed: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# PHASE 2: hospital quality pre-cache (first 600 facilities from general info)
# ---------------------------------------------------------------------------
Log '--- PHASE 2: hospital quality pre-cache ---'
$genInfo = 'xubh-q36u'   # Hospital General Information dataset id (validated by probe)
try {
    $probe = @(Unwrap (Invoke-RestMethod -Uri "https://data.cms.gov/data-api/v1/dataset/$genInfo/data" -Body @{ size = 1; offset = 0 } -Method Get -TimeoutSec 60))
    $cols = $probe[0].PSObject.Properties.Name
    $facCol = $cols | Where-Object { $_ -match 'facility.*id|ccn' } | Select-Object -First 1
    Log "general-info columns resolved, facility column: '$facCol'"
    if (-not $facCol) { Log 'WARN: could not find facility id column; skipping phase 2' }
    else {
        $facs = New-Object System.Collections.Generic.List[string]
        for ($off = 0; $off -lt 600 -and $facs.Count -lt 600; $off += 200) {
            $rows = @(Unwrap (Invoke-RestMethod -Uri "https://data.cms.gov/data-api/v1/dataset/$genInfo/data" -Body @{ size = 200; offset = $off } -Method Get -TimeoutSec 60))
            if ($rows.Count -eq 0) { break }
            foreach ($r in $rows) {
                $f = "$($r.$facCol)".Trim()
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
} catch {
    Log "WARN phase 2 failed: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# PHASE 3: MIPS wave 2, gated on tonight's run completing (same upstream host)
# ---------------------------------------------------------------------------
Log '--- PHASE 3: waiting for MIPS run 1 to finish ---'
$waited = 0
$marker = 'MIPS-first seeding complete'
while ($waited -lt 360) {
    if ((Test-Path $seedLog) -and (Select-String -Path $seedLog -Pattern $marker -Quiet)) {
        Log 'run 1 complete marker found; starting MIPS wave 2'
        break
    }
    Start-Sleep -Seconds 60
    $waited++
    if ($waited % 15 -eq 0) { Log "still waiting for run 1 ($waited min)" }
}
if ($waited -ge 360) {
    Log 'WARN: timed out waiting for run 1 (6h); skipping wave 2 to avoid doubling upstream load'
} else {
    $wave2States = 'GA','NJ','WA','AZ','MA','CO','MI','NC'
    Log "launching v5 with states: $($wave2States -join ',')"
    & powershell -ExecutionPolicy Bypass -File "$project\tools\overnight-mips-seed.ps1" -States $wave2States -PerState 400
    Log "wave 2 launcher returned"
}

Log '=== wave2 overnight complete ==='
Write-Host ''
Write-Host 'DONE. This window can be closed.'
