[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$OfficialPayloadRoot,
  [string]$OutputRoot = (Join-Path $env:LOCALAPPDATA 'HarnessMaintenance\artifacts'),
  [string]$Node = (Get-Command node.exe -ErrorAction Stop).Source,
  [string]$NpmCli
)
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'desktop-tools'

$v=(Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding utf8|ConvertFrom-Json).version
$dest=Join-Path $OutputRoot "harness-maintenance-tools-$v"
if((Test-Path -LiteralPath $dest) -and @(Get-ChildItem -LiteralPath $dest -Force).Count){throw 'Refuse to overwrite an existing version artifact'}
$official=(Get-Item -LiteralPath $OfficialPayloadRoot -Force).FullName
if (!$NpmCli) { $NpmCli=Join-Path (Split-Path -Parent $Node) 'node_modules\npm\bin\npm-cli.js' }
if (!(Test-Path -LiteralPath $NpmCli -PathType Leaf)) { throw 'npm CLI not found; specify -NpmCli' }
$expected='bad50d18a3cf42621ac03aeaf1dc527ee20384ca4c0b7eee64512954ddb9a76e'
$exe=Join-Path $official 'DeepSeek Harness.exe'
if((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $expected){throw 'Verified host executable differs'}
if((Get-FileHash -LiteralPath (Join-Path $official 'resources\app.asar') -Algorithm SHA256).Hash -ne '5fa8a6b21bceb8f3e99e30efa2270efd0cc773a11e42aa0488f804a64b34e637'){throw 'Verified host archive differs'}
& $node --test (Join-Path $source 'records.test.mjs') (Join-Path $source 'skills.test.mjs')
if($LASTEXITCODE -ne 0){throw 'unit tests failed'}
$stage=Join-Path $env:LOCALAPPDATA ('HarnessMaintenance\phase2-build-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage)|Out-Null
$metadata=& $Node $NpmCli pack $source --json --ignore-scripts --pack-destination $stage --cache (Join-Path $stage 'npm-cache')
if($LASTEXITCODE -ne 0){throw 'npm pack failed'}
$packed=($metadata|Out-String)|ConvertFrom-Json
$archive=Join-Path $stage $packed.filename
$members=@(& tar.exe -tf $archive)
$allow=@('package/package.json','package/README.md','package/catalog.mjs','package/cli.mjs','package/index.mjs','package/records.mjs','package/skills.mjs','package/cordis.patch.yml')
if($LASTEXITCODE -ne 0 -or @(Compare-Object ($members|Sort-Object) ($allow|Sort-Object)).Count){throw 'unexpected archive members'}
$extract=Join-Path $stage 'extract'
[IO.Directory]::CreateDirectory($extract)|Out-Null
& tar.exe -xf $archive -C $extract
if($LASTEXITCODE -ne 0){throw 'archive extraction failed'}
$stdout=Join-Path $stage 'official-host.stdout';$stderr=Join-Path $stage 'official-host.stderr'
$arg='"'+(Join-Path $source 'Test-OfficialHost.mjs')+'" "'+$official+'" "'+(Join-Path $extract 'package')+'"'
$env:ELECTRON_RUN_AS_NODE='1'
try {
  $p=Start-Process -FilePath $exe -ArgumentList $arg -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WorkingDirectory $stage
  if($p.ExitCode -ne 0){Get-Content -LiteralPath $stderr -Tail 15;throw 'official runtime test failed'}
}finally{Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue}
$raw=Get-Content -LiteralPath $stdout -Raw -Encoding utf8
if(!$raw){throw 'official host test produced no evidence'}
$native=$raw|ConvertFrom-Json
if($native.executed -ne 4 -or !$native.cleanupVerified -or !$native.promptRendererVerified){throw 'official host test evidence incomplete'}
[IO.Directory]::CreateDirectory($dest)|Out-Null
$artifact=Join-Path $dest $packed.filename
# Copy package bytes, not EFS attributes from the local scratch directory.
$stream=[IO.File]::Open($artifact,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
  $sourceStream=[IO.File]::OpenRead($archive)
  try {$sourceStream.CopyTo($stream);$stream.Flush($true)} finally {$sourceStream.Dispose()}
} finally {$stream.Dispose()}
if((Get-FileHash -LiteralPath $archive).Hash -ne (Get-FileHash -LiteralPath $artifact).Hash){throw 'Package byte copy failed verification'}
[ordered]@{version=$v;package=$artifact;sha256=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant();members=$members;unitTests=14;officialHostTest=$native;productionInstalled=$false}|
  ConvertTo-Json -Depth 8|Tee-Object -FilePath (Join-Path $dest 'validation.json')
