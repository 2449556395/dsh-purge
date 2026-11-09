# Upgrade the selected DeepSeek Harness profile to a pinned wxcvm fork release.
# Does not apply host patches, delete targets, or restart the application.
param(
  [string]$DshHome = '',
  [ValidateSet('desktop','web')][string]$Profile = 'desktop',
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$version = '1.1.92-wxcvm.3'
$source = 'https://codeload.github.com/wxcvm/dsh-purge/tar.gz/refs/tags/v1.1.92-wxcvm.3'

if (-not $DshHome) {
  $candidates = @()
  if ($env:DSH_HOME) { $candidates += $env:DSH_HOME }
  if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE '.dsh') }
  if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'DeepSeek Harness\dsh-home') }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'DeepSeek Harness\dsh-home') }
  $homes = @($candidates | Select-Object -Unique | Where-Object {
    Test-Path -LiteralPath (Join-Path $_ "profiles\$Profile\package.json") -PathType Leaf
  })
  if ($homes.Count -ne 1) {
    $homes | ForEach-Object { Write-Host "Possible DSH_HOME: $_" }
    throw 'Specify -DshHome explicitly: no unique active profile was found.'
  }
  $DshHome = $homes[0]
}

$profileDir = Join-Path $DshHome "profiles\$Profile"
$manifest = Join-Path $profileDir 'package.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Profile manifest not found: $manifest" }
$plugin = Join-Path $profileDir 'node_modules\dsh-purge'
$pluginManifest = Join-Path $plugin 'package.json'
$oldVersion = '(not installed)'
if (Test-Path -LiteralPath $pluginManifest -PathType Leaf) {
  $oldVersion = (Get-Content -LiteralPath $pluginManifest -Raw | ConvertFrom-Json).version
}
Write-Host "DSH profile: $profileDir"
Write-Host "Installed dsh-purge: $oldVersion"
if ($CheckOnly) {
  if ($oldVersion -ne $version) { throw "Expected $version in this profile; found $oldVersion" }
  foreach ($file in @('client.js','lib\redteam\ui.js','lib\redteam\client.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $plugin $file) -PathType Leaf)) {
      throw "Installed package is incomplete: $file"
    }
  }
  Write-Host "PASS: selected profile contains dsh-purge $version and required UI files."
  return
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'pnpm was not found. Install pnpm or use dsh plugin add with the pinned tag URL.'
}

# Preserve files that pnpm and postinstall may change in this profile.
$backup = Join-Path ([IO.Path]::GetTempPath()) ('dsh-purge-profile-backup-' + [guid]::NewGuid().ToString('N'))
New-Item -Path $backup -ItemType Directory -Force | Out-Null
$files = @('package.json', 'pnpm-lock.yaml', 'cordis.patch.yml')
$had = @{}
foreach ($file in $files) {
  $original = Join-Path $profileDir $file
  $had[$file] = Test-Path -LiteralPath $original -PathType Leaf
  if ($had[$file]) { Copy-Item -LiteralPath $original -Destination (Join-Path $backup $file) -Force }
}
$success = $false
Push-Location $profileDir
try {
  Write-Host "Installing $version from $source"
  & pnpm add $source
  if ($LASTEXITCODE -ne 0) { throw "pnpm add failed with code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $pluginManifest -PathType Leaf)) { throw 'Installed package manifest is missing' }
  $actual = (Get-Content -LiteralPath $pluginManifest -Raw | ConvertFrom-Json).version
  if ($actual -ne $version) { throw "Installed version $actual does not match $version" }
  foreach ($file in @('client.js','lib\redteam\ui.js','lib\redteam\client.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $plugin $file) -PathType Leaf)) {
      throw "Installed package is missing required UI file: $file"
    }
  }
  $success = $true
  Write-Host "PASS: installed dsh-purge $version in $profileDir"
} catch {
  $problem = $_.Exception.Message
  $rollbackStatus = 'restored profile manifest and lockfile'
  foreach ($file in $files) {
    $original = Join-Path $profileDir $file
    if ($had[$file]) {
      Copy-Item -LiteralPath (Join-Path $backup $file) -Destination $original -Force
    } elseif (Test-Path -LiteralPath $original) {
      Remove-Item -LiteralPath $original -Force
    }
  }
  if ($had['pnpm-lock.yaml']) {
    & pnpm install --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { $rollbackStatus += '; dependency reinstall failed (manual recovery needed)' }
  } else {
    $rollbackStatus += '; no original lockfile; dependencies were not automatically restored'
  }
  throw "Upgrade failed: $problem. Rollback: $rollbackStatus. Profile backup: $backup"
} finally {
  Pop-Location
  if ($success) { Remove-Item -LiteralPath $backup -Recurse -Force }
}
Write-Host 'Fully quit DSH Desktop, including its tray process, and reopen it.'
Write-Host 'Then inspect 作战台 > 管理 > 指南 > 检查实际安装副本 / 技能库 / 已归档靶标.'
