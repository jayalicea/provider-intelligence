# setup-refresh-tracking.ps1: switch the scheduled refresh tasks to run through
# tools/run-tracked.ps1, so each run is recorded for GET /health/data.
#
# Finds every Task Scheduler task whose action runs one of the four refresh
# scripts, and rewrites that action to call the wrapper with the matching
# -Job name. Schedules, triggers, accounts and any script arguments are kept.
# Tasks already using run-tracked.ps1 are left alone, so re-running is safe.
#
# Preview (default, changes nothing):
#   powershell -ExecutionPolicy Bypass -File tools\setup-refresh-tracking.ps1
# Apply (run from an elevated prompt if the tasks were created as admin):
#   powershell -ExecutionPolicy Bypass -File tools\setup-refresh-tracking.ps1 -Apply

param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot

# Script file -> job name in src/config/refresh-jobs.js
$Jobs = [ordered]@{
  'clia-director-enrich.ps1' = 'clia-director'
  'cannabis-refresh-all.ps1' = 'cannabis'
  'monthly-leie-refresh.ps1' = 'leie'
  'clia-refresh.ps1'         = 'clia'
}

# Returns the wrapper arguments for an action's argument string, or $null when
# the action does not run $ScriptName (or already runs the wrapper).
function Get-TrackedArguments([string]$Arguments, [string]$ScriptName, [string]$Job) {
  if (-not $Arguments -or $Arguments -match 'run-tracked\.ps1') { return $null }
  $pattern = '-File\s+("?)(?<path>[^"\s]*' + [regex]::Escape($ScriptName) + ')\1(?<rest>.*)$'
  $m = [regex]::Match($Arguments, $pattern, 'IgnoreCase')
  if (-not $m.Success) { return $null }
  $scriptPath = $m.Groups['path'].Value
  $rest = $m.Groups['rest'].Value.Trim()
  $new = "-NoProfile -ExecutionPolicy Bypass -File `"$project\tools\run-tracked.ps1`" -Job $Job -Script `"$scriptPath`""
  if ($rest) { $new += " -ScriptArgs `"$($rest -replace '"', '')`"" }
  return $new
}

if ($MyInvocation.InvocationName -eq '.') { return }  # dot-sourced by tests: define functions only

$found = @{}
foreach ($task in Get-ScheduledTask) {
  $changed = $false
  $newActions = foreach ($action in $task.Actions) {
    $replacement = $null
    foreach ($script in $Jobs.Keys) {
      $newArgs = Get-TrackedArguments $action.Arguments $script $Jobs[$script]
      if ($newArgs) { $replacement = $newArgs; $found[$Jobs[$script]] = "$($task.TaskPath)$($task.TaskName)"; break }
      if ($action.Arguments -match 'run-tracked\.ps1' -and $action.Arguments -match [regex]::Escape($script)) {
        $found[$Jobs[$script]] = "$($task.TaskPath)$($task.TaskName) (already tracked)"
      }
    }
    if ($replacement) {
      $changed = $true
      Write-Host "$($task.TaskPath)$($task.TaskName)"
      Write-Host "  old: $($action.Execute) $($action.Arguments)"
      Write-Host "  new: powershell $replacement"
      New-ScheduledTaskAction -Execute 'powershell' -Argument $replacement -WorkingDirectory $project
    } else {
      $action
    }
  }
  if ($changed -and $Apply) {
    Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $newActions | Out-Null
    Write-Host '  updated'
  }
}

Write-Host ''
foreach ($job in $Jobs.Values) {
  if ($found[$job]) { Write-Host "$job -> $($found[$job])" }
  else { Write-Warning "$job : no scheduled task runs its script; create one (see README) or /health/data will report it as never run" }
}
if (-not $Apply) { Write-Host "`nPreview only. Re-run with -Apply to make these changes." }
