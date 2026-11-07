# 上游变更检查（不走 git fetch——这台机上 fetch 会卡在大对象上）
# 用法: pwsh -NoProfile -File .\maintenance\check-upstream.ps1 [-Repo HunYiSage/dsh-purge]
param(
  [string]$Repo = 'HunYiSage/dsh-purge',
  [string]$LocalDir = 'C:\Users\Kerna\.dsh\plugins\dsh-purge',
  [int]$Top = 5
)
$ErrorActionPreference = 'Stop'
$api = "https://api.github.com/repos/$Repo"

function Get-Json([string]$url) {
  try { return Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'dsh-purge-check' } -TimeoutSec 30 }
  catch { Write-Host ("!! " + $url + " -> " + $_.Exception.Message) -ForegroundColor Yellow; return $null }
}

$pkg = Get-Content (Join-Path $LocalDir 'package.json') -Raw | ConvertFrom-Json
$tags = Get-Json "$api/tags?per_page=$Top"
$commits = Get-Json "$api/commits?per_page=$Top"
$pulls = Get-Json "$api/pulls?state=open&per_page=10"

Write-Host ("本地版本   " + $pkg.version + "   dshTarget=" + $pkg.dshTarget)
if ($tags) { Write-Host ("上游 tag   " + (($tags | ForEach-Object { $_.name }) -join ", ")) }
if ($commits) {
  Write-Host "上游最近提交:"
  foreach ($c in $commits) {
    $first = ($c.commit.message -split [char]10)[0]
    Write-Host ("  " + $c.sha.Substring(0,7) + "  " + $c.commit.author.date + "  " + $first)
  }
}
if ($pulls) {
  Write-Host ("开放 PR    " + $pulls.Count)
  foreach ($p in $pulls) {
    Write-Host ("  #" + $p.number + "  " + $p.title + "  [" + $p.mergeable_state + "]  +" + $p.additions + "/-" + $p.deletions + "  " + $p.head.label)
  }
}

$upstreamTag = if ($tags) { $tags[0].name -replace "^v", "" } else { $null }
if ($upstreamTag) {
  $localBase = ($pkg.version -split "-")[0]
  if ($localBase -eq $upstreamTag) { Write-Host ("`n=> 代码基线已对齐上游 tag v" + $upstreamTag + "（私有补丁另计）") -ForegroundColor Green }
  else { Write-Host ("`n=> 上游 tag v" + $upstreamTag + " 与本地基线 " + $localBase + " 不同，需人工比对") -ForegroundColor Yellow }
}