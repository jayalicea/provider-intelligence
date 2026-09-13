# quality-more-hospitals.ps1: extend quality-measures cache from ~600 to ~3600 hospitals.
# Sequential, jittered, resumable. Leave window open.

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\hospitals-wave2.log"
$apiBase = 'http://localhost:3000/api/v1'
$genInfo = 'xubh-q36u'
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
function Get-Rows($limit, $offset){
  try {
    return @(Unwrap-Rows (Invoke-RestMethod -Uri "https://data.cms.gov/provider-data/api/1/datastore/query/$genInfo/0" -Body @{ limit = $limit; offset = $offset } -Method Get -TimeoutSec 60))
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Log "WARN offset $offset : HTTP $code $($_.Exception.Message)"
    return @()
  }
}

Log '=== hospital quality wave 2 started (offsets 600-3600) ==='
$facs = New-Object System.Collections.Generic.List[string]
for ($off = 600; $off -lt 3600; $off += 200) {
    $rows = Get-Rows 200 $off
    if ($rows.Count -eq 0) { Log "no more rows at offset $off"; break }
    foreach ($r in $rows) {
        $f = "$($r.facility_id)".Trim().TrimStart("'")
        if ($f -match '^\d{6}$' -and -not $facs.Contains($f)) { $facs.Add($f) }
    }
    Jitter 1200 2500
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
Log '=== hospital quality wave 2 complete ==='
Write-Host 'DONE. This window can be closed.'
