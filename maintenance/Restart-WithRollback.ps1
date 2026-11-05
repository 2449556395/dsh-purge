<#
.SYNOPSIS
  Restart the DeepSeek Harness desktop with the unpacked (patched) app tree, and roll
  back to the sealed app.asar automatically if the desktop does not come up.

.DESCRIPTION
  Background: dsh-purge unpacks resources\app.asar into resources\app and patches that
  tree. Electron prefers app.asar when it exists, so the patch only takes effect after
  app.asar is moved aside. If the unpacked tree cannot boot, this script puts app.asar
  back and starts the sealed build again, so the desktop never stays dark.

.PARAMETER InstallRoot
  Desktop install root, e.g. D:\dsh

.PARAMETER BootWaitSeconds
  How long to wait for a main window after launching.

.PARAMETER DryRun
  Only run preflight and print the plan. No process is touched, no file is moved.

.EXAMPLE
  pwsh -NoProfile -File .\maintenance\Restart-WithRollback.ps1 -InstallRoot 'D:\dsh' -DryRun
  pwsh -NoProfile -File .\maintenance\Restart-WithRollback.ps1 -InstallRoot 'D:\dsh'
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'D:\dsh',
  [int]$BootWaitSeconds = 60,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$exe       = Join-Path $InstallRoot 'DeepSeek Harness.exe'
$resources = Join-Path $InstallRoot 'resources'
$appDir    = Join-Path $resources 'app'
$asar      = Join-Path $resources 'app.asar'
$asarBak   = Join-Path $resources 'app.asar.bak'
$report    = [ordered]@{
  at        = (Get-Date).ToString('o')
  installRoot = $InstallRoot
  dryRun    = [bool]$DryRun
  preflight = $null
  steps     = @()
  result    = 'Unknown'
}

function Say([string]$msg) { Write-Host $msg }

# ---------- preflight ----------
$problems = @()
if (-not (Test-Path -LiteralPath $exe)) { $problems += "missing exe: $exe" }
if (-not (Test-Path -LiteralPath $appDir)) { $problems += "no unpacked app tree: $appDir (run reapply-after-update.mjs first)" }
if (-not (Test-Path -LiteralPath $asar) -and -not (Test-Path -LiteralPath $asarBak)) {
  $problems += "neither app.asar nor app.asar.bak exists: $resources"
}

$exeVersion = $null
$appVersion = $null
if (Test-Path -LiteralPath $exe) { $exeVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion }
if (Test-Path -LiteralPath (Join-Path $appDir 'package.json')) {
  try { $appVersion = (Get-Content -LiteralPath (Join-Path $appDir 'package.json') -Raw | ConvertFrom-Json).version } catch { }
}

$report.preflight = [ordered]@{
  exe          = $exe
  exeVersion   = $exeVersion
  appVersion   = $appVersion
  versionMatch = ($exeVersion -and $appVersion -and ($exeVersion.Trim() -eq $appVersion.Trim()))
  asarPresent  = (Test-Path -LiteralPath $asar)
  asarBakPresent = (Test-Path -LiteralPath $asarBak)
  appPresent   = (Test-Path -LiteralPath $appDir)
  problems     = $problems
}

Say ("install root : {0}" -f $InstallRoot)
Say ("exe version  : {0}" -f $exeVersion)
Say ("app version  : {0}" -f $appVersion)
Say ("layout       : app={0} asar={1} asar.bak={2}" -f $report.preflight.appPresent, $report.preflight.asarPresent, $report.preflight.asarBakPresent)

if ($problems.Count -gt 0) {
  foreach ($p in $problems) { Say ("PRECHECK FAIL: {0}" -f $p) }
  $report.result = 'PreflightFailed'
  $report | ConvertTo-Json -Depth 6
  exit 2
}
if (-not $report.preflight.versionMatch) {
  Say ("WARN: exe version {0} != unpacked app version {1}; rollback will restore app.asar" -f $exeVersion, $appVersion)
}

if ($DryRun) {
  Say ''
  Say 'PLAN (dry run, nothing executed):'
  Say '  1. stop Desktop Harness processes (main first, then --type= children)'
  Say ("  2. move {0} -> {1}" -f $asar, $asarBak)
  Say ("  3. start {0}" -f $exe)
  Say ("  4. wait {0}s for a main window" -f $BootWaitSeconds)
  Say ("  5. on failure: restore {0}, start again, report RolledBack" -f $asarBak)
  $report.result = 'DryRunOk'
  $report | ConvertTo-Json -Depth 6
  exit 0
}

# ---------- 1. stop processes ----------
function Get-HarnessProcesses {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -eq $exe } catch { $false }
  }
}
function Stop-Harness {
  $procs = @(Get-HarnessProcesses)
  if ($procs.Count -eq 0) { return 0 }
  # main process = no --type= on the command line
  $main = @($procs | Where-Object {
      $cl = $null
      try { $cl = (Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $_.Id)).CommandLine } catch { }
      -not ($cl -match '--type=')
    })
  foreach ($p in $main) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { } }
  Start-Sleep -Milliseconds 1500
  foreach ($p in @(Get-HarnessProcesses)) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { } }
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and @(Get-HarnessProcesses).Count -gt 0) { Start-Sleep -Milliseconds 500 }
  return @(Get-HarnessProcesses).Count
}

Say ''
Say '[1/5] stopping desktop processes'
$left = Stop-Harness
$report.steps += [ordered]@{ step = 'stop'; remaining = $left }
Say ("      remaining processes: {0}" -f $left)
if ($left -gt 0) {
  Say 'STOP FAIL: desktop still running, refusing to swap files'
  $report.result = 'StopFailed'
  $report | ConvertTo-Json -Depth 6
  exit 3
}

# ---------- 2. move asar aside ----------
Say '[2/5] moving app.asar aside'
try {
  if (Test-Path -LiteralPath $asar) {
    if (Test-Path -LiteralPath $asarBak) { Remove-Item -LiteralPath $asarBak -Force -ErrorAction Stop }
    Move-Item -LiteralPath $asar -Destination $asarBak -Force -ErrorAction Stop
    $report.steps += [ordered]@{ step = 'swap'; action = 'asar -> asar.bak' }
    Say '      app.asar -> app.asar.bak'
  } else {
    $report.steps += [ordered]@{ step = 'swap'; action = 'already-aside' }
    Say '      app.asar already absent (unpacked tree takes over)'
  }
  Remove-Item -LiteralPath (Join-Path $resources 'app.asar.rename-pending') -Force -ErrorAction SilentlyContinue
} catch {
  Say ("SWAP FAIL: {0}" -f $_.Exception.Message)
  $report.result = 'SwapFailed'
  $report | ConvertTo-Json -Depth 6
  exit 4
}

# ---------- 3. launch ----------
Say '[3/5] starting desktop'
Start-Process -FilePath $exe -WorkingDirectory $InstallRoot | Out-Null

# ---------- 4. wait for window ----------
Say ("[4/5] waiting up to {0}s for a main window" -f $BootWaitSeconds)
$deadline = (Get-Date).AddSeconds($BootWaitSeconds)
$ok = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 800
  $procs = @(Get-HarnessProcesses)
  if ($procs.Count -eq 0) { continue }
  if (@($procs | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0) { $ok = $true; break }
}
$report.steps += [ordered]@{ step = 'boot'; windowVisible = $ok; processes = @(Get-HarnessProcesses).Count }

if ($ok) {
  Say '      desktop is up (unpacked patched tree loaded)'
  $report.result = 'Patched'
  $report | ConvertTo-Json -Depth 6
  exit 0
}

# ---------- 5. rollback ----------
Say '[5/5] no window appeared, rolling back to sealed app.asar'
try {
  foreach ($p in @(Get-HarnessProcesses)) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { } }
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $asarBak) {
    if (Test-Path -LiteralPath $asar) { Remove-Item -LiteralPath $asar -Force -ErrorAction Stop }
    Move-Item -LiteralPath $asarBak -Destination $asar -Force -ErrorAction Stop
    Say '      app.asar.bak -> app.asar'
  } else {
    Say '      no app.asar.bak to restore'
  }
  Start-Process -FilePath $exe -WorkingDirectory $InstallRoot | Out-Null
  $report.steps += [ordered]@{ step = 'rollback'; restored = (Test-Path -LiteralPath $asar) }
  $report.result = 'RolledBack'
} catch {
  Say ("ROLLBACK FAIL: {0}" -f $_.Exception.Message)
  $report.steps += [ordered]@{ step = 'rollback'; error = $_.Exception.Message }
  $report.result = 'RollbackFailed'
}

$report | ConvertTo-Json -Depth 6
exit 5
