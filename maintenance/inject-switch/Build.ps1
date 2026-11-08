# Compile the optional WinForms switch from repository source.
# Uses the .NET Framework compiler already included with supported Windows installations.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$source = Join-Path $PSScriptRoot 'InjectSwitch.cs'
$dest = Join-Path $PSScriptRoot 'dist'
$out = Join-Path $dest 'dsh-inject-switch.exe'

$compilers = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $compilers | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'The .NET Framework 4.x C# compiler was not found.' }

New-Item -Path $dest -ItemType Directory -Force | Out-Null
$arguments = @(
    '/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
    "/out:$out", $source
)
& $csc @arguments

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $out)) {
    throw 'Failed to compile dsh-inject-switch.exe'
}
Write-Output "Built: $out"
