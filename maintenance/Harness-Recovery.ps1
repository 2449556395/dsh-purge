[CmdletBinding()]
param(
  [ValidateSet('Audit','Prepare','Restore','Rollback')][string]$Mode = 'Audit',
  [string]$InstallRoot,
  [string]$ProfileRoot = (Join-Path $HOME '.dsh\profiles\desktop'),
  [string]$UpdaterRoot = (Join-Path $env:LOCALAPPDATA '@deepseek-aidsh-desktop-updater'),
  [string]$EvidenceRoot = (Join-Path $env:LOCALAPPDATA 'HarnessMaintenance\recovery-runs'),
  [string]$SevenZip = (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
  [string]$Node = 'node.exe',
  [string]$RunDirectory
)

$ErrorActionPreference = 'Stop'
$script:Vendor = 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.'
$script:Feed = 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'
$script:Archive = 'resources\app.asar'

function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-PlainPath([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  while ($item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point not allowed: $($item.FullName)" }
    $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
  }
}
function Write-Receipt($Data, [string]$Path) {
  $stream = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $payload = [Text.Encoding]::UTF8.GetBytes(($Data | ConvertTo-Json -Depth 15) + [Environment]::NewLine)
    $stream.Write($payload,0,$payload.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
}
function Copy-BytesCreateNew([string]$Source,[string]$Destination) {
  # Copy content rather than inheriting EFS attributes across volumes.
  $inputStream=[IO.File]::OpenRead($Source)
  try {
    $outputStream=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $inputStream.CopyTo($outputStream); $outputStream.Flush($true) } finally { $outputStream.Dispose() }
  } finally { $inputStream.Dispose() }
}
function Get-VendorIdentity([string]$Path) {
  $sig = Get-AuthenticodeSignature -LiteralPath $Path
  $simpleName = if ($sig.SignerCertificate) {
    $sig.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  }
  [ordered]@{ status=[string]$sig.Status; publisher=$simpleName; trusted=($sig.Status -eq 'Valid' -and $simpleName -ceq $script:Vendor) }
}
function Read-DesktopFeed([string]$Text) {
  function Read-Key([string]$Name) {
    # Only top-level scalar fields. Do not interpret YAML tags, anchors or scripts.
    $pattern = '(?m)^' + [regex]::Escape($Name) + ':[ \t]*(?:>-[ \t]*\r?\n[ \t]+([^ \t\r\n][^\r\n]*)|([^ \t\r\n][^\r\n]*))\r?$'
    $m = [regex]::Matches($Text,$pattern)
    if ($m.Count -ne 1) { throw "Invalid or duplicate feed key: $Name" }
    ($m[0].Groups[1].Value + $m[0].Groups[2].Value).Trim()
  }
  $version = Read-Key 'version'
  if ($version -notmatch '^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$') { throw 'Invalid desktop feed version' }
  $url = Read-Key 'path'
  $required = "https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-$version-win-x64.exe"
  if ($url -cne $required) { throw 'Installer URI outside the pinned official layout' }
  $hash = Read-Key 'sha512'
  try { $bytes = [Convert]::FromBase64String($hash) } catch { throw 'Malformed feed SHA-512' }
  if ($bytes.Length -ne 64 -or [Convert]::ToBase64String($bytes) -cne $hash) { throw 'Malformed feed SHA-512' }
  [ordered]@{ uri=$script:Feed; version=$version; installer=$url; sha512=$hash }
}
function Test-Installer([string]$Path, $Feed) {
  Assert-PlainPath $Path
  $sig = Get-VendorIdentity $Path
  if (-not $sig.trusted) { throw 'Cached installer is not signed by the official publisher' }
  $hash = [Convert]::ToBase64String([Convert]::FromHexString((Get-FileHash -LiteralPath $Path -Algorithm SHA512).Hash))
  if ($hash -cne $Feed.sha512) { throw 'Cached installer SHA-512 differs from the official feed' }
  if ((Get-Item -LiteralPath $Path).VersionInfo.FileVersion -cne $Feed.version) { throw 'Cached installer version differs from the official feed' }
  [ordered]@{path=$Path;version=$Feed.version;sha512=$hash;signature=$sig}
}
function Get-Layout([string]$Root) {
  $packed = Test-Path -LiteralPath (Join-Path $Root $script:Archive) -PathType Leaf
  $unpacked = Test-Path -LiteralPath (Join-Path $Root 'resources\app') -PathType Container
  if ($packed -and $unpacked) { return 'Conflict' }
  if ($packed) { return 'Packed' }
  if ($unpacked -and (Test-Path -LiteralPath (Join-Path $Root 'resources\app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js') -PathType Leaf)) { return 'Unpacked' }
  return 'Missing'
}
function Get-InstallProcesses([string]$Root) {
  $prefix = $Root.TrimEnd('\') + '\'
  # Do not read process arguments, stop anything or assume matching names are ours.
  @(Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) -or
    (-not $_.ExecutablePath -and $_.Name -eq 'DeepSeek Harness.exe')
  } | ForEach-Object {
    [ordered]@{ id=$_.ProcessId; name=$_.Name; creationDate=$_.CreationDate; executable=$_.ExecutablePath }
  })
}
function Get-ProfileFacts([string]$Root) {
  $files = [ordered]@{}
  foreach ($name in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')) {
    $p = Join-Path $Root $name
    if (Test-Path -LiteralPath $p -PathType Leaf) { $files[$name]=Get-Sha256 $p }
  }
  $j = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $patch = Join-Path $Root 'cordis.patch.yml'
  $mention = (Test-Path -LiteralPath $patch -PathType Leaf) -and
    ((Get-Content -LiteralPath $patch -Raw -Encoding utf8) -match '(?i)\bdsh-purge\b')
  $commonPatch = Join-Path (Split-Path -Parent (Split-Path -Parent $Root)) 'cordis.patch.yml'
  $commonMention = (Test-Path -LiteralPath $commonPatch -PathType Leaf) -and
    ((Get-Content -LiteralPath $commonPatch -Raw -Encoding utf8) -match '(?i)\bdsh-purge\b')
  if (Test-Path -LiteralPath $commonPatch -PathType Leaf) { $files['home/cordis.patch.yml']=Get-Sha256 $commonPatch }
  $src = [string]$j.dependencies.'dsh-purge'
  [ordered]@{
    path=$Root; sha256=$files; localPluginReference=($src -match '^(link|file|workspace):')
    targetConfigured=($mention -or $commonMention -or (@($j.dsh.profile.bundles) -contains 'dsh-purge'))
    enabledBundles=@($j.dsh.profile.bundles | Where-Object {$_ -is [string] -and $_ -match '^[A-Za-z0-9@._/-]+$'})
  }
}
function Get-FailureEvidence([string]$CacheRoot,[string]$DesktopLogs) {
  $installer = @(Get-ChildItem -LiteralPath (Join-Path $CacheRoot 'installer-logs') -Filter 'directory-failure-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 10 | ForEach-Object {
      $raw = Get-Content -LiteralPath $_.FullName -Raw
      $operation = [regex]::Match($raw,'(?m)^Operation:\s*([a-zA-Z0-9_]+)').Groups[1].Value
      $code = [regex]::Match($raw,'(?m)^Windows error:\s*(\d+)').Groups[1].Value
      [ordered]@{file=$_.Name; at=$_.LastWriteTime.ToString('o');operation=$operation;windowsCode=$code;classification=if($code -eq '32'){'SharingViolation'}else{'DirectoryOperationFailed'}}
    })
  $startup = @(Get-ChildItem -LiteralPath $DesktopLogs -Filter 'crash-*-host.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 12 | ForEach-Object {
      $raw = Get-Content -LiteralPath $_.FullName -Raw
      [ordered]@{file=$_.Name;at=$_.LastWriteTime.ToString('o');classification=if($raw -match 'desktop welcome: Web authentication failed'){'DesktopWelcomeAuthenticationFailed'}elseif($raw -match 'desktop welcome: Web request failed'){'DesktopWelcomeRequestFailed'}else{'OtherHostCrash'}}
    })
  [ordered]@{installer=$installer;startup=$startup}
}
function Get-RunStatus($E) {
  if ($E.installerStarted -isnot [bool] -or -not $E.installerStarted) { return 'InstallerNotRun' }
  if ($null -eq $E.installerExitCode) { return 'InstallerExitNotObserved' }
  if ($E.installerExitCode -ne 0) { return 'InstallerFailed' }
  if ($E.expectedVersionOnDisk -isnot [bool] -or -not $E.expectedVersionOnDisk) { return 'DiskVersionMismatch' }
  if ($E.newDesktopProcess -isnot [bool] -or -not $E.newDesktopProcess) { return 'DesktopStartNotConfirmed' }
  if ($E.hostReady -isnot [bool] -or -not $E.hostReady) { return 'HostReadyNotConfirmed' }
  if ($E.desktopAuthenticated -eq $false) { return 'DesktopAuthenticationFailed' }
  if ($E.desktopAuthenticated -ne $true) { return 'DesktopAuthenticationNotMeasured' }
  return 'Ready'
}
function Assert-RestoreReady($State,[switch]$OfflineRollback) {
  if ($State.layout -ne 'Packed') { throw 'Restore requires an unambiguous packed layout' }
  if (@($State.installProcesses).Count -ne 0) { throw 'Restore blocked: desktop/owned processes are still present; save and exit normally' }
  if ($State.profile.targetConfigured) { throw 'Restore blocked: host-changing plugin is still configured; no automatic profile changes or reapply' }
  if (-not $State.exeSignature.trusted) { throw 'Restore blocked: current executable publisher is not verified' }
  if (-not $OfflineRollback -and (-not $State.feed -or $State.diskVersion -cne $State.feed.version)) { throw 'Restore blocked: a same-version official package is required' }
}
function Assert-PairedPayload($Proof) {
  if ($Proof.expectedFiles -lt 2 -or @($Proof.missing).Count -or @($Proof.unexpectedCompanions).Count) { throw 'Official payload companions do not match' }
  $different = @($Proof.changed)
  if ($different.Count -ne 1 -or $different[0] -cne 'resources/app.asar') { throw 'Restore requires the archive to be the only differing packaged file' }
}
function Assert-FileExclusive([string]$Path) {
  try { $handle = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $handle.Dispose() }
  catch { throw "Cannot exclusively open archive; no replacement performed: $($_.Exception.GetType().Name)" }
}
function Set-ArchiveAtomic([string]$Target,[string]$Candidate,[string]$ExpectedOld,[string]$ExpectedNew,[scriptblock]$Precommit) {
  Assert-PlainPath $Target
  Assert-PlainPath $Candidate
  if ((Get-Sha256 $Target) -cne $ExpectedOld -or (Get-Sha256 $Candidate) -cne $ExpectedNew) { throw 'Archive fingerprints changed before replacement' }
  Assert-FileExclusive $Target
  $temp = Join-Path (Split-Path -Parent $Target) ('.harness-recovery-'+[guid]::NewGuid().ToString('N')+'.tmp')
  $oldTemp = "$temp.before"
  try {
    Copy-BytesCreateNew $Candidate $temp
    if ((Get-Sha256 $temp) -cne $ExpectedNew) { throw 'Candidate copy hash mismatch' }
    & $Precommit
    if ((Get-Sha256 $Target) -cne $ExpectedOld) { throw 'Installed archive changed during preparation' }
    Assert-FileExclusive $Target
    [IO.File]::Replace($temp,$Target,$oldTemp)
    if ((Get-Sha256 $Target) -cne $ExpectedNew -or (Get-Sha256 $oldTemp) -cne $ExpectedOld) {
      throw 'Replacement readback mismatch; retained temporary original, inspect receipt before further writes'
    }
    Remove-Item -LiteralPath $oldTemp -Force
  } finally {
    if (Test-Path -LiteralPath $temp -PathType Leaf) { Remove-Item -LiteralPath $temp -Force }
  }
}
function Invoke-SevenZip([string]$Tool,[string]$Archive,[string]$Output,[string[]]$Members=@()) {
  [IO.Directory]::CreateDirectory($Output) | Out-Null
  $null = & $Tool x -y "-o$Output" $Archive @Members
  if ($LASTEXITCODE -ne 0) { throw "7-Zip extraction failed (exit $LASTEXITCODE)" }
}
function Invoke-JsonNode([string]$Runtime,[string]$Script,[string[]]$Arguments) {
  $lines = & $Runtime (Join-Path $PSScriptRoot $Script) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Script failed (exit $LASTEXITCODE)" }
  ($lines | Out-String) | ConvertFrom-Json
}

function Invoke-Main {
  if ([string]::IsNullOrWhiteSpace($InstallRoot) -or -not [IO.Path]::IsPathFullyQualified($InstallRoot)) {
    throw 'Supply the absolute -InstallRoot for the intended desktop installation'
  }
  $root = (Get-Item -LiteralPath $InstallRoot -Force).FullName
  Assert-PlainPath $root
  $exe = Join-Path $root 'DeepSeek Harness.exe'
  Assert-PlainPath $exe
  $dest = Join-Path $root $script:Archive
  $feed=$null; $feedError=$null
  if ($Mode -ne 'Rollback') {
    try {
      $config = Join-Path $root 'resources\app-update.yml'
      $cfg = Get-Content -LiteralPath $config -Raw -Encoding utf8
      if ($cfg -notmatch '(?m)^url: https://download\.deepseek\.com/dsh-desk/feeds/win-x64/\r?$' -or
          $cfg -notmatch '(?m)^channel: nightly\r?$') { throw 'Installed desktop update channel does not match the supported official Windows feed' }
      $http = Invoke-WebRequest -Uri $script:Feed -TimeoutSec 25 -MaximumRedirection 0
      $text = if ($http.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($http.Content) } else { [string]$http.Content }
      $feed = Read-DesktopFeed $text
    } catch {
      $feedError=$_.Exception.Message
      if ($Mode -ne 'Audit') {throw}
    }
  }
  $state = [ordered]@{
    capturedAt=(Get-Date).ToString('o'); mode=$Mode; installRoot=$root; layout=(Get-Layout $root)
    diskVersion=(Get-Item -LiteralPath $exe).VersionInfo.FileVersion; exeSignature=(Get-VendorIdentity $exe)
    exeSha256=(Get-Sha256 $exe); feed=$feed; feedError=$feedError; installProcesses=@(Get-InstallProcesses $root)
    profile=(Get-ProfileFacts $ProfileRoot)
    historicalFailures=(Get-FailureEvidence $UpdaterRoot (Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\logs'))
    updateRunStatus=(Get-RunStatus @{installerStarted=$false}); desktopAuthentication='NotMeasured'
  }
  $cached=Join-Path $UpdaterRoot 'installer.exe'
  if ($feed -and (Test-Path -LiteralPath $cached -PathType Leaf)) {
    try { $state.cachedInstaller=Test-Installer $cached $feed }
    catch { $state.cachedInstallerError=$_.Exception.Message }
  }
  if ($Mode -eq 'Audit') { $state | ConvertTo-Json -Depth 15; return }
  if ($Mode -in @('Restore','Rollback')) { Assert-RestoreReady $state -OfflineRollback:($Mode -eq 'Rollback') }
  if ($Mode -eq 'Rollback') {
    if (-not $RunDirectory) { throw 'Rollback requires the exact -RunDirectory produced by Restore' }
    $r = (Get-Item -LiteralPath $RunDirectory).FullName
    Assert-PlainPath $r
    $expectedRoot = [IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\') + '\'
    if (!$r.StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $r) -notmatch '^recovery-\d{8}-\d{6}-[0-9a-f]{8}$') {throw 'Rollback directory must be a generated recovery run under EvidenceRoot'}
    if (Test-Path -LiteralPath (Join-Path $r 'rollback-result.json')) {throw 'Rollback already recorded'}
    $journal = Get-Content -LiteralPath (Join-Path $r 'archive-transaction.json') -Raw -Encoding utf8 | ConvertFrom-Json
    if ($journal.installRoot -cne $root -or $journal.version -cne $state.diskVersion -or $journal.exeSha256 -cne $state.exeSha256) {
      throw 'Rollback receipt does not match the current installation and version'
    }
    $backup = Join-Path $r 'before-app.asar'
    $payload = Join-Path $r 'official-payload'
    if ((Get-Sha256 (Join-Path $payload $script:Archive)) -cne $journal.after) {throw 'Staged official archive no longer matches the receipt'}
    $proof=Invoke-JsonNode $Node 'payload-evidence.mjs' @($payload,$root)
    if ($proof.expectedFiles -lt 2 -or @($proof.missing).Count -or @($proof.changed).Count -or @($proof.unexpectedCompanions).Count) {
      throw 'Rollback blocked: current installation is not the official payload recorded for this transaction'
    }
    Set-ArchiveAtomic $dest $backup $journal.after $journal.before {
      if (@(Get-InstallProcesses $root).Count) {throw 'Install process appeared'}
      if ((Get-Layout $root) -cne 'Packed' -or (Get-Sha256 $exe) -cne $state.exeSha256) {throw 'Installation identity changed'}
      if ((Get-ProfileFacts $ProfileRoot).targetConfigured) {throw 'Host-changing plugin was enabled during preparation'}
    }
    Write-Receipt ([ordered]@{at=(Get-Date).ToString('o'); restored=(Get-Sha256 $dest); desktopStarted=$false}) (Join-Path $r 'rollback-result.json')
    Write-Output $r
    return
  }
  if ($state.layout -ne 'Packed') { throw 'Preparation requires an unambiguous packed layout; unpacked layout is recognized for diagnosis only' }
  if ($state.diskVersion -cne $feed.version) { throw 'Official channel differs from disk version; use the official installer flow, not an archive swap' }
  if (-not $state.cachedInstaller) { throw 'No verified same-version official cached installer; production was not changed' }
  $parent = [IO.Path]::GetFullPath($EvidenceRoot)
  $rootPrefix = $root.TrimEnd('\') + '\'
  $profilePrefix = [IO.Path]::GetFullPath($ProfileRoot).TrimEnd('\') + '\'
  $dshHomePrefix = (Split-Path -Parent (Split-Path -Parent $profilePrefix.TrimEnd('\'))).TrimEnd('\') + '\'
  foreach($prefix in @($rootPrefix,$profilePrefix,$dshHomePrefix)) {
    if (($parent.TrimEnd('\')+'\').StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence directory must be outside install and profile' }
  }
  $ancestor=$parent
  while (-not (Test-Path -LiteralPath $ancestor -PathType Container)) {
    $next=Split-Path -Parent $ancestor
    if (!$next -or $next -ceq $ancestor) {throw 'Cannot locate an existing evidence parent'}
    $ancestor=$next
  }
  Assert-PlainPath $ancestor
  $run=Join-Path $parent ('recovery-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
  [IO.Directory]::CreateDirectory($run)|Out-Null
  Write-Receipt $state (Join-Path $run 'baseline.json')
  $box=Join-Path $run 'nsis'
  $member='$PLUGINSDIR\app-64.7z'
  Invoke-SevenZip $SevenZip $cached $box @($member)
  $payload=Join-Path $run 'official-payload'
  Invoke-SevenZip $SevenZip (Join-Path $box $member) $payload
  $null=Test-Installer $cached $feed
  $official=Join-Path $payload $script:Archive
  Assert-PlainPath $official
  $proof=Invoke-JsonNode $Node 'payload-evidence.mjs' @($payload,$root)
  Write-Receipt $proof (Join-Path $run 'payload-diff.json')
  $archiveDiff=Invoke-JsonNode $Node 'archive-evidence.mjs' @($official,$dest)
  Write-Receipt $archiveDiff (Join-Path $run 'archive-diff.json')
  $before=Get-Sha256 $dest; $after=Get-Sha256 $official
  $summary=[ordered]@{run=$run;productionModified=$false;desktopStarted=$false;installedArchiveSha256=$before;officialArchiveSha256=$after;
    otherPackagedFilesMatch=(@($proof.missing).Count -eq 0 -and @($proof.unexpectedCompanions).Count -eq 0 -and @($proof.changed|Where-Object {$_ -cne 'resources/app.asar'}).Count -eq 0);
    updateAvailableFromFeed=$false; stage='SameVersionEvidenceOnly'}
  if ($Mode -eq 'Restore' -and $before -ceq $after -and $summary.otherPackagedFilesMatch) {
    $summary.stage='AlreadyMatchesOfficialPayload'
  } elseif ($Mode -eq 'Restore') {
    Assert-PairedPayload $proof
    if ($archiveDiff.officialCliKind -cne 'packed') {throw 'Official CLI member missing or not packed'}
    $backup=Join-Path $run 'before-app.asar'
    Copy-BytesCreateNew $dest $backup
    if ((Get-Sha256 $backup) -cne $before) {throw 'Backup readback mismatch'}
    Write-Receipt ([ordered]@{installRoot=$root;version=$state.diskVersion;exeSha256=$state.exeSha256;before=$before;after=$after}) (Join-Path $run 'archive-transaction.json')
    Set-ArchiveAtomic $dest $official $before $after {
      if (@(Get-InstallProcesses $root).Count) { throw 'Install process appeared' }
      if ((Get-Layout $root) -cne 'Packed' -or (Get-Sha256 $exe) -cne $state.exeSha256) {throw 'Installation identity changed'}
      if ((Get-ProfileFacts $ProfileRoot).targetConfigured) {throw 'Host-changing plugin was enabled during preparation'}
    }
    $summary.productionModified=$true; $summary.stage='SameVersionArchiveRestoredAwaitingUserStartup'
  }
  Write-Receipt $summary (Join-Path $run 'result.json')
  $summary | ConvertTo-Json -Depth 8
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-Main }
