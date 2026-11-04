$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Harness-Recovery.ps1')
$script:Passed=0
function Case([string]$Name,[scriptblock]$Check) { & $Check; $script:Passed++; Write-Output "PASS $Name" }
function Eq($Actual,$Expected) { if ($Actual -cne $Expected) {throw "Expected [$Expected], got [$Actual]"} }
function Fails([scriptblock]$Action,[string]$Pattern) {
  try { & $Action; throw 'TEST_UNEXPECTED_SUCCESS' }
  catch { if ($_.Exception.Message -notmatch $Pattern) { throw } }
}
$h=[Convert]::ToBase64String([byte[]]::new(64))
$yaml=@"
version: 0.2.2-rc.1
path: >-
  https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.1-win-x64.exe
sha512: $h
"@
Case 'pinned official channel and folded YAML' { Eq (Read-DesktopFeed $yaml).version '0.2.2-rc.1' }
Case 'arbitrary installer URL rejected' { Fails {Read-DesktopFeed ($yaml.Replace('download.deepseek.com','example.invalid'))} 'outside' }
Case 'duplicate feed key rejected' { Fails {Read-DesktopFeed ($yaml+[Environment]::NewLine+'version: 0.2.2-rc.1')} 'duplicate' }
Case 'malformed installer hash rejected' { Fails {Read-DesktopFeed ($yaml.Replace($h,'bad'))} 'SHA-512' }
$valid=@{layout='Packed';installProcesses=@();profile=@{targetConfigured=$false};exeSignature=@{trusted=$true};diskVersion='0.2.2-rc.1';feed=@{version='0.2.2-rc.1'}}
Case 'preflight blocks active process' { $x=$valid.Clone(); $x.installProcesses=@(@{id=123}); Fails {Assert-RestoreReady $x} 'still present' }
Case 'preflight blocks configured host-changing component' { $x=$valid.Clone();$x.profile=@{targetConfigured=$true};Fails {Assert-RestoreReady $x} 'still configured' }
Case 'preflight blocks version mismatch and conflicting layout' {
  $x=$valid.Clone();$x.diskVersion='0.2.1-rc.5';Fails {Assert-RestoreReady $x} 'same-version'
  $x=$valid.Clone();$x.layout='Conflict';Fails {Assert-RestoreReady $x} 'unambiguous'
}
Case 'offline rollback need not use the current feed' {
  $x=$valid.Clone();$x.feed=$null
  Fails {Assert-RestoreReady $x} 'same-version'
  Assert-RestoreReady $x -OfflineRollback
}
Case 'nonarchive payload drift and missing files block swap' {
  Fails {Assert-PairedPayload @{expectedFiles=3;missing=@();unexpectedCompanions=@();changed=@('resources/app.asar','DeepSeek Harness.exe')}} 'only differing'
  Fails {Assert-PairedPayload @{expectedFiles=3;missing=@('runtime/file');unexpectedCompanions=@();changed=@('resources/app.asar')}} 'companions'
}
Case 'installer exit and launch proof are independently evaluated' {
  $x=@{installerStarted=$false};Eq (Get-RunStatus $x) 'InstallerNotRun'
  $x.installerStarted=$true;Eq (Get-RunStatus $x) 'InstallerExitNotObserved'
  $x.installerExitCode=32;Eq (Get-RunStatus $x) 'InstallerFailed'
  $x.installerExitCode=0;Eq (Get-RunStatus $x) 'DiskVersionMismatch'
  $x.expectedVersionOnDisk=$true;Eq (Get-RunStatus $x) 'DesktopStartNotConfirmed'
  $x.newDesktopProcess=$true;Eq (Get-RunStatus $x) 'HostReadyNotConfirmed'
  $x.hostReady=$true;Eq (Get-RunStatus $x) 'DesktopAuthenticationNotMeasured'
  $x.desktopAuthenticated=$false;Eq (Get-RunStatus $x) 'DesktopAuthenticationFailed'
  $x.desktopAuthenticated=$true;Eq (Get-RunStatus $x) 'Ready'
}
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('harness-maintenance-test-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture)|Out-Null
$original=Join-Path $fixture 'before.bin'
$target=Join-Path $fixture 'live.bin'
$candidate=Join-Path $fixture 'official.bin'
$receipt=Join-Path $fixture 'receipt.json'
try {
  [IO.File]::WriteAllText($original,'before')
  [IO.File]::Copy($original,$target)
  [IO.File]::WriteAllText($candidate,'verified official')
  $a=Get-Sha256 $original;$b=Get-Sha256 $candidate
  Case 'locked target is not replaced' {
    $hold=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try { Fails {Set-ArchiveAtomic $target $candidate $a $b {}} 'exclusively open';Eq (Get-Sha256 $target) $a }
    finally {$hold.Dispose()}
  }
  Case 'stale source or late busy signal leaves the old file unchanged' {
    Fails {Set-ArchiveAtomic $target $candidate $b $b {}} 'fingerprints'
    Fails {Set-ArchiveAtomic $target $candidate $a $b {throw 'busy before commit'}} 'busy before'
    Eq (Get-Sha256 $target) $a
    Eq @(Get-ChildItem -LiteralPath $fixture -Filter '.harness-recovery-*.tmp' -Force).Count 0
  }
  Case 'atomic replacement and hash-guarded reversal on Windows' {
    Set-ArchiveAtomic $target $candidate $a $b {}
    Eq (Get-Sha256 $target) $b
    Set-ArchiveAtomic $target $original $b $a {}
    Eq (Get-Sha256 $target) $a
  }
  Case 'receipt cannot overwrite earlier evidence' {
    Write-Receipt @{state='before'} $receipt
    Fails {Write-Receipt @{state='after'} $receipt} 'already exists|已存在'
    Eq ((Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json).state) 'before'
  }
} finally {
  foreach($p in @($original,$target,$candidate,$receipt)) {if(Test-Path -LiteralPath $p -PathType Leaf){Remove-Item -LiteralPath $p}}
  if (@(Get-ChildItem -LiteralPath $fixture -Force).Count -eq 0) {[IO.Directory]::Delete($fixture,$false)}
}
Write-Output "PASS $script:Passed cases"
