# clia-director-enrich.ps1: scheduled incremental QCOR director backfill.
#
# Each run enriches one bounded batch of registered labs whose
# director_name is NULL (stalest sync first) via
# tools/clia-director-qcor.js --backfill. At the default 150/day the
# high-value registered set covers itself over time; QCOR is a government
# operational system, so the rate stays courteous and the batch stays
# bounded. Runs daily at 03:30.
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\clia-director-enrich.ps1 [-BatchSize 150]

param([int]$BatchSize = 150)

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
$log     = "$project\logs\clia-director.log"
Set-Location $project

function Log($m){ $l="$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $l; Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" }

Log "=== clia director enrich started (batch $BatchSize) ==="
node tools\clia-director-qcor.js --backfill $BatchSize
if ($LASTEXITCODE -ne 0) { Log "WARN enrich run failed (exit $LASTEXITCODE)" } else { Log "=== clia director enrich finished ===" }
