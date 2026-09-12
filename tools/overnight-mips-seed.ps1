# overnight-mips-seed.ps1: MIPS-first enrichment.
# Pulls scored-clinician NPIs from the CMS QPP dataset per state, then caches provider
# details + MIPS scores through the local API. Leave this window OPEN overnight.

$ErrorActionPreference = 'Continue'
$project  = 'C:\Users\casalab\provider-intelligence'
$log      = "$project\logs\mips-seed.log"
$states   = 'MD','VA','PA','NY','IL','OH','FL','TX','CA'
$perState = 500
$pageSize = 500
$dataset  = '7adb8b1b-b85c-4ed3-b314-064776e50180'
$apiBase  = 'http://localhost:3000/api/v1'
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }
function Jitter($a,$b){ Start-Sleep -Milliseconds (Get-Random -Minimum $a -Maximum $b) }
function Unwrap($resp){
  if ($resp -is [array]) { return $resp }
  if ($resp.data) { return $resp.data }
  return @()
}

Log '=== MIPS-first seeding started ==='

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
    $probe = curl.exe -s "https://data.cms.gov/data-api/v1/dataset/$dataset/data?size=1&offset=0" | ConvertFrom-Json
    $cols = (Unwrap $probe)[0].PSObject.Properties.Name
    $npiCol   = $cols | Where-Object { $_ -match 'npi' }        | Select-Object -First 1
    $stateCol = $cols | Where-Object { $_ -match 'state' }      | Select-Object -First 1
    $scoreCol = $cols | Where-Object { $_ -match 'final.*score|score.*final' } | Select-Object -First 1
    if (-not $scoreCol) { $scoreCol = $cols | Where-Object { $_ -match 'score' } | Select-Object -First 1 }
    Log "dataset columns resolved: NPI='$npiCol' STATE='$stateCol' SCORE='$scoreCol'"
    if (-not $npiCol -or -not $stateCol) { Log 'FATAL: could not resolve column names'; exit 1 }
} catch {
    Log "FATAL: dataset probe failed: $($_.Exception.Message)"
    exit 1
}

# 2. Collect scored NPIs per state from the dataset, then enrich through the API
$grandTotal = 0
foreach ($st in $states) {
    $npis = New-Object System.Collections.Generic.List[string]
    for ($off = 0; $off -lt 7000 -and $npis.Count -lt $perState; $off += $pageSize) {
        try {
            $url = "https://data.cms.gov/data-api/v1/dataset/$dataset/data?size=$pageSize&offset=$off&filter[$stateCol]=$st"
            $rows = Unwrap (curl.exe -s $url | ConvertFrom-Json)
            if ($rows.Count -eq 0) { break }
            foreach ($r in $rows) {
                $score = $r.$scoreCol
                $npi   = "$($r.$npiCol)".Trim()
                if ($npi -match '^\d{10}$' -and $score -and "$score" -notmatch 'Not Available|Too Small|^$') {
                    if (-not $npis.Contains($npi)) { $npis.Add($npi) }
                    if ($npis.Count -ge $perState) { break }
                }
            }
            Jitter 1500 3000
        } catch {
            Log "WARN $st offset $off : $($_.Exception.Message)"
        }
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
