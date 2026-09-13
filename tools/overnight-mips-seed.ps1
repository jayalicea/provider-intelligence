# overnight-mips-seed.ps1 v5: MIPS-first enrichment, parameterized states.
# Usage: run with defaults for the original 9 states, or pass -States for a wave.
# Leave the window OPEN while running.

param(
  [string[]]$States = @('MD','VA','PA','NY','IL','OH','FL','TX','CA'),
  [int]$PerState = 500
)

# Normalize: -File binding can deliver the state list as one comma-joined string.
$States = @($States | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$ErrorActionPreference = 'Continue'
$project  = 'C:\Users\casalab\provider-intelligence'
$log      = "$project\logs\mips-seed.log"
$pageSize = 500
$dataset  = '7adb8b1b-b85c-4ed3-b314-064776e50180'
$dataUri  = "https://data.cms.gov/data-api/v1/dataset/$dataset/data"
$apiBase  = 'http://localhost:3000/api/v1'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }
function Jitter($a,$b){ Start-Sleep -Milliseconds (Get-Random -Minimum $a -Maximum $b) }
function Unwrap($resp){
  if ($null -eq $resp) { return @() }
  if ($resp -is [array]) { return $resp }
  if ($resp.data) { return @($resp.data) }
  return @($resp)
}
function Get-DatasetRows($state, $offset){
  $body = @{ size = $pageSize; offset = $offset; "filter[$script:stateCol]" = $state }
  try {
    return @(Unwrap (Invoke-RestMethod -Uri $dataUri -Body $body -Method Get -TimeoutSec 60))
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Log "WARN dataset $state offset $offset : HTTP $code $($_.Exception.Message)"
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      Log "WARN body: $($_.ErrorDetails.Message.Substring(0, [Math]::Min(160, $_.ErrorDetails.Message.Length)))"
    }
    return @()
  }
}

Log "=== MIPS-first seeding started (v5, states: $($States -join ',')) ==="

# 0. Start backend if not listening
$listening = netstat -ano | findstr ':3000' | findstr LISTENING
if (-not $listening) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
    $server = Start-Process $node -ArgumentList 'src/app.js' -WorkingDirectory $project -PassThru -WindowStyle Hidden
    Log "backend started, pid $($server.Id)"
    Start-Sleep -Seconds 5
} else { Log 'backend already running' }

# 1. Probe the CMS dataset once to resolve real column names
try {
    $probe = @(Unwrap (Invoke-RestMethod -Uri $dataUri -Body @{ size = 1; offset = 0 } -Method Get -TimeoutSec 60))
    $cols = $probe[0].PSObject.Properties.Name
    $script:npiCol   = $cols | Where-Object { $_ -match 'npi' }   | Select-Object -First 1
    $script:stateCol = $cols | Where-Object { $_ -match 'state' } | Select-Object -First 1
    $script:scoreCol = $cols | Where-Object { $_ -match 'final.*score|score.*final' } | Select-Object -First 1
    if (-not $script:scoreCol) { $script:scoreCol = $cols | Where-Object { $_ -match 'score' } | Select-Object -First 1 }
    Log "dataset columns resolved: NPI='$($script:npiCol)' STATE='$($script:stateCol)' SCORE='$($script:scoreCol)'"
    if (-not $script:npiCol -or -not $script:stateCol) {
        Log "FATAL: no matching columns; first probe row:"
        Log ("  " + (($probe[0] | ConvertTo-Json -Compress -Depth 2).Substring(0, [Math]::Min(400, ($probe[0] | ConvertTo-Json -Compress -Depth 2).Length))))
        exit 1
    }
} catch {
    Log "FATAL: dataset probe failed: $($_.Exception.Message)"
    exit 1
}

# 2. Collect scored NPIs per state from the dataset, then enrich through the local API
$grandTotal = 0
foreach ($st in $States) {
    $npis = New-Object System.Collections.Generic.List[string]
    for ($off = 0; $off -lt 7000 -and $npis.Count -lt $PerState; $off += $pageSize) {
        $rows = Get-DatasetRows $st $off
        if ($off -eq 0 -and $rows.Count -eq 0) {
            Log "WARN $st : first page empty, check WARN lines above for the HTTP status"
        }
        if ($rows.Count -eq 0) { break }
        foreach ($r in $rows) {
            $score = $r.($script:scoreCol)
            $npi   = "$($r.($script:npiCol))".Trim()
            if ($npi -match '^\d{10}$' -and $score -and "$score" -notmatch 'Not Available|Too Small|^$') {
                if (-not $npis.Contains($npi)) { $npis.Add($npi) }
                if ($npis.Count -ge $PerState) { break }
            }
        }
        Jitter 1500 3000
    }
    Log "$st : $($npis.Count) scored NPIs found in dataset"

    $n = 0
    foreach ($npi in $npis) {
        $n++
        Write-Host "`r$st enrich $n of $($npis.Count)" -NoNewline
        curl.exe -s "$apiBase/providers/$npi" | Out-Null
        curl.exe -s "$apiBase/providers/$npi/mips-performance?year=2023" | Out-Null
        Jitter 2000 4500
    }
    Write-Host ''
    $grandTotal += $npis.Count
    Log "$st : enrichment complete"
    Jitter 8000 15000
}

Log "TOTAL enriched: $grandTotal scored providers targeted"
Log '=== MIPS-first seeding complete ==='
Write-Host ''
Write-Host 'DONE. This window can be closed.'
