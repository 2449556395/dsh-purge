$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'update-desktop-fork.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('dsh-purge-updater-test-' + [guid]::NewGuid().ToString('N'))
$profile = Join-Path $fixture 'profiles\desktop'
$plugin = Join-Path $profile 'node_modules\dsh-purge'
$bin = Join-Path $fixture 'bin'
$oldPath = $env:PATH
try {
  New-Item -Path (Join-Path $plugin 'lib\redteam') -ItemType Directory -Force | Out-Null
  New-Item -Path $bin -ItemType Directory -Force | Out-Null
  $version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
  $manifest = '{"name":"dsh-profile-desktop","dependencies":{"dsh-purge":"original-spec"}}'
  Set-Content -LiteralPath (Join-Path $profile 'package.json') -Value $manifest -NoNewline
  Set-Content -LiteralPath (Join-Path $profile 'pnpm-lock.yaml') -Value 'original-lock' -NoNewline
  Set-Content -LiteralPath (Join-Path $plugin 'package.json') -Value ('{"version":"' + $version + '"}') -NoNewline
  foreach ($file in @('client.js','lib\redteam\ui.js','lib\redteam\client.js')) {
    Set-Content -LiteralPath (Join-Path $plugin $file) -Value 'fixture' -NoNewline
  }
  & $script -DshHome $fixture -CheckOnly
  if (-not $?) { throw 'CheckOnly did not succeed' }
  # Simulated failing package manager; never downloads anything.
  Set-Content -LiteralPath (Join-Path $bin 'pnpm.cmd') -Value ("@echo off" + [Environment]::NewLine + "exit /b 9") -Encoding Ascii
  $env:PATH = $bin + [IO.Path]::PathSeparator + $env:PATH
  $failed = $false
  try { & $script -DshHome $fixture } catch { $failed = $true }
  if (-not $failed) { throw 'Expected simulated pnpm failure' }
  if ((Get-Content -LiteralPath (Join-Path $profile 'package.json') -Raw) -ne $manifest) {
    throw 'Profile manifest was not restored'
  }
  if ((Get-Content -LiteralPath (Join-Path $profile 'pnpm-lock.yaml') -Raw) -ne 'original-lock') {
    throw 'Original lockfile was not restored'
  }
  Write-Host 'PASS: read-only verification and failed-install profile rollback'
  # Clear the expected non-zero native exit from our fake pnpm; otherwise the
  # GitHub pwsh wrapper treats a successful test as a failed job.
  $global:LASTEXITCODE = 0
} finally {
  $env:PATH = $oldPath
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}
