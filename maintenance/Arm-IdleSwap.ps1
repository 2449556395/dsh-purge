<#
.SYNOPSIS
  Arm a detached watcher that swaps app.asar aside the next time the desktop exits
  normally, so the unpacked (patched) app tree takes over on the next launch.

.DESCRIPTION
  dsh-purge unpacks resources\app.asar into resources\app and patches that tree, but
  Electron prefers app.asar whenever it exists. Killing the host from inside a session
  is not acceptable, so this script does nothing until the desktop is gone: you just
  close the window (or reboot), and the watcher finishes the swap and relaunches.

  Safety: if the unpacked tree cannot bring up a main window, app.asar is restored and
  the sealed build is launched again. Every step is appended to a log.

.PARAMETER InstallRoot
  Desktop install root, default D:\dsh

.PARAMETER TimeoutMinutes
  How long to keep waiting for the desktop to exit. Default 720.

.PARAMETER Disarm
  Remove the pending marker and stop waiting (a running watcher exits on its own).

.EXAMPLE
  pwsh -NoProfile -File .\maintenance\Arm-IdleSwap.ps1 -InstallRoot 'D:\dsh'          # arm
  pwsh -NoProfile -File .\maintenance\Arm-IdleSwap.ps1 -InstallRoot 'D:\dsh' -Status  # show
  pwsh -NoProfile -File .\maintenance\Arm-IdleSwap.ps1 -InstallRoot 'D:\dsh' -Disarm  # cancel
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = 'D:\dsh',
  [int]$TimeoutMinutes = 720,
  [int]$BootWaitSeconds = 90,
  [switch]$Worker,
  [switch]$Status,
  [switch]$Disarm
)

$ErrorActionPreference = 'Stop'
$exe       = Join-Path $InstallRoot 'DeepSeek Harness.exe'
$resources = Join-Path $InstallRoot 'resources'
$appDir    = Join-Path $resources 'app'
$asar      = Join-Path $resources 'app.asar'
$asarBak   = Join-Path $resources 'app.asar.bak'
$stateDir  = Join-Path $env:LOCALAPPDATA 'dsh-purge'
$null      = New-Item -ItemType Directory -Force -Path $stateDir
$lockFile  = Join-Path $stateDir 'idle-swap.armed'
$logFile   = Join-Path $stateDir 'idle-swap.log'
$pidFile   = Join-Path $stateDir 'idle-swap.pid'
$self      = $MyInvocation.MyCommand.Path

function Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date).ToString('o'), $msg
  Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
  if ($Worker) { } else { Write-Host $line }
}
function Running {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $exe } catch { $false } })
}

if ($Status) {
  $workerPid = $null
  $workerAlive = $false
  if (Test-Path -LiteralPath $pidFile) {
    $workerPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    if (Get-Process -Id $workerPid -ErrorAction SilentlyContinue) { $workerAlive = $true }
  }
  [ordered]@{
    armed        = (Test-Path -LiteralPath $lockFile)
    workerPid    = $workerPid
    workerAlive  = $workerAlive
    layout       = [ordered]@{
      app         = (Test-Path -LiteralPath $appDir)
      asar        = (Test-Path -LiteralPath $asar)
      asarBak     = (Test-Path -LiteralPath $asarBak)
      pendingMark = (Test-Path -LiteralPath (Join-Path $resources 'app.asar.rename-pending'))
    }
    desktopProcs = (Running).Count
    log          = $logFile
  } | ConvertTo-Json -Depth 5
  exit 0
}

if ($Disarm) {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $pidFile) {
    $wpid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    Stop-Process -Id $wpid -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
  Log 'disarmed'
  'disarmed'
  exit 0
}

# ---------- arm ----------
if (-not $Worker) {
  if (-not (Test-Path -LiteralPath $appDir)) { 'REFUSE: no unpacked app tree at ' + $appDir; exit 2 }
  if (-not (Test-Path -LiteralPath $exe))    { 'REFUSE: missing exe ' + $exe; exit 2 }
  if (Test-Path -LiteralPath $lockFile) { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue }
  Set-Content -LiteralPath $lockFile -Value ((Get-Date).ToString('o')) -Encoding utf8
  $pwshExe = (Get-Process -Id $PID).Path
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $self,
            '-Worker', '-InstallRoot', $InstallRoot,
            '-TimeoutMinutes', $TimeoutMinutes, '-BootWaitSeconds', $BootWaitSeconds)
  $p = Start-Process -FilePath $pwshExe -ArgumentList $args -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $pidFile -Value $p.Id -Encoding utf8
  Log ("armed: watcher pid={0} installRoot={1} timeout={2}min" -f $p.Id, $InstallRoot, $TimeoutMinutes)
  [ordered]@{ armed = $true; watcherPid = $p.Id; log = $logFile; note = 'close the desktop window normally; the swap happens after it exits' } | ConvertTo-Json -Depth 4
  exit 0
}

# ---------- worker ----------
Log ("worker start pid={0}; waiting for desktop exit (timeout {1}min)" -f $PID, $TimeoutMinutes)
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Date) -lt $deadline) {
  if (-not (Test-Path -LiteralPath $lockFile)) { Log 'worker exit: disarmed externally'; exit 0 }
  if (-not (Test-Path -LiteralPath $asar))     { Log 'worker exit: app.asar already absent'; exit 0 }
  if ((Running).Count -eq 0) { break }
  Start-Sleep -Seconds 2
}
if ((Get-Date) -ge $deadline) { Log 'worker exit: timeout reached, desktop never exited'; exit 1 }

Log 'desktop exited; swapping'
Start-Sleep -Seconds 3
try {
  if (Test-Path -LiteralPath $asarBak) { Remove-Item -LiteralPath $asarBak -Force -ErrorAction Stop }
  Move-Item -LiteralPath $asar -Destination $asarBak -Force -ErrorAction Stop
  Log 'moved app.asar -> app.asar.bak'
  Remove-Item -LiteralPath (Join-Path $resources 'app.asar.rename-pending') -Force -ErrorAction SilentlyContinue
} catch {
  Log ('swap failed: ' + $_.Exception.Message + ' (desktop left untouched)')
  exit 3
}

Start-Process -FilePath $exe -WorkingDirectory $InstallRoot | Out-Null
$ok = $false
$dl = (Get-Date).AddSeconds($BootWaitSeconds)
while ((Get-Date) -lt $dl) {
  Start-Sleep -Milliseconds 800
  if ((Running | Where-Object { $_.MainWindowHandle -ne 0 })) { $ok = $true; break }
}
if ($ok) {
  Log 'desktop is up on the unpacked patched tree'
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  exit 0
}

Log 'no main window; rolling back to sealed app.asar'
foreach ($p in (Running)) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { } }
Start-Sleep -Seconds 2
try {
  if (Test-Path -LiteralPath $asarBak) {
    if (Test-Path -LiteralPath $asar) { Remove-Item -LiteralPath $asar -Force -ErrorAction Stop }
    Move-Item -LiteralPath $asarBak -Destination $asar -Force -ErrorAction Stop
    Log 'restored app.asar.bak -> app.asar'
  }
  Start-Process -FilePath $exe -WorkingDirectory $InstallRoot | Out-Null
  Log 'sealed build relaunched'
} catch {
  Log ('rollback failed: ' + $_.Exception.Message)
}
Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
exit 5
