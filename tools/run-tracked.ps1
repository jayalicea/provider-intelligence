# run-tracked.ps1: run a scheduled refresh script and record the run in
# data_refresh_runs, so GET /health/data can report stale or failed jobs.
#
# Point each scheduled task at this wrapper instead of the script itself:
#   powershell -ExecutionPolicy Bypass -File tools\run-tracked.ps1 -Job leie -Script tools\monthly-leie-refresh.ps1
# Arguments for the wrapped script go in one string:
#   ... -Job clia-director -Script tools\clia-director-enrich.ps1 -ScriptArgs "-BatchSize 150"
#
# -Job must be a key in src/config/refresh-jobs.js. The wrapped script's exit
# code becomes the run status (0 = success). Tracking is best effort: if the
# database is unreachable the script still runs and its exit code is kept.

param(
  [Parameter(Mandatory = $true)][string]$Job,
  [Parameter(Mandatory = $true)][string]$Script,
  [string]$ScriptArgs = ''
)

$ErrorActionPreference = 'Continue'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

$runId = $null
$out = & node tools/refresh-run.js start $Job 2>&1
if ($LASTEXITCODE -eq 0 -and "$out" -match '^\d+$') {
  $runId = "$out"
} else {
  Write-Warning "run-tracked: could not record start of '$Job': $out"
}

$exitCode = 1
$detail = ''
try {
  # A separate process gives a reliable exit code even when the script
  # calls 'exit' or ends on an error.
  # (-File does not turn a comma list into an array, hence one string.)
  $argList = @()
  if ($ScriptArgs.Trim()) { $argList = $ScriptArgs.Trim() -split '\s+' }
  $shell = (Get-Process -Id $PID).Path
  & $shell -NoProfile -ExecutionPolicy Bypass -File $Script @argList
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 0 }
} catch {
  $detail = $_.Exception.Message
} finally {
  if ($runId) {
    $fin = & node tools/refresh-run.js finish $runId $exitCode $detail 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Warning "run-tracked: could not record finish of '$Job': $fin" }
  }
}

exit $exitCode
