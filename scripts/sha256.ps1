#requires -Version 5.1
<#
.SYNOPSIS
  发布产物 SHA256 自动计算：列哈希 → 写 SHA256SUMS → 回填 / 核对 latest.json。

.DESCRIPTION
  默认扫 build\installer\Zetla_<package.json 版本>（不存在则 build\installer），
  递归收集文件，打印「文件 / 大小 / SHA256」，并写一份 sha256sum 兼容的
  SHA256SUMS（LF 换行、无 BOM，可直接 `sha256sum -c`）。

  -Patch  按清单里 URL 的文件名把哈希写回 sha256 字段：只改这一个值，其余字节
          原样保留（缩进、换行、中文都不动）；所有文件都找到时顺手删掉占位用的
          _draft 字段。
  -Check  只核对：清单里的 sha256 与本地产物是否一致，不一致时退出码 1。

  注意：SHA256 只能由真实产物算出，脚本绝不编造。清单里仍为空串的条目会被前端
  cleanInstallers 丢弃（客户端表现为「本次更新暂未提供当前平台的安装包」），
  所以占位清单不会让用户装错包。

.PARAMETER Dir
  产物目录，默认 build\installer\Zetla_<版本>。相对路径先按当前目录解析，再按仓库根解析。

.PARAMETER Manifest
  清单路径，默认仓库根的 latest.json。

.PARAMETER FallbackDir
  本目录找不到的文件，再到这个目录按文件名找一次（默认 build\installer，这样
  build\installer\Zetla_0.3.0\ 里没放 exe 也能算到）；传空串关闭。

.PARAMETER Out
  SHA256SUMS 输出路径，默认写到 <Dir>\SHA256SUMS。

.PARAMETER Check
  核对清单与本地产物是否一致。

.PARAMETER Patch
  把本地哈希回填进清单的 sha256 字段。

.PARAMETER Json
  以 JSON（文件名 → 哈希）输出，便于管道处理。

.PARAMETER NoSumFile
  不写 SHA256SUMS。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sha256.ps1

.EXAMPLE
  npm run release:sha -- -Patch

.EXAMPLE
  npm run release:sha -- -Check
#>
[CmdletBinding()]
param(
  [string]$Dir,
  [string]$Manifest = "latest.json",
  [string]$FallbackDir = "build/installer",
  [string]$Out,
  [switch]$Check,
  [switch]$Patch,
  [switch]$Json,
  [switch]$NoSumFile
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- 基础工具

function Fail([string]$message) {
  Write-Output ""
  Write-Output ("[XX] " + $message)
  exit 2
}

function To-Abs([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $null }
  if ([System.IO.Path]::IsPathRooted($path)) { return $path }
  $fromCwd = Join-Path (Get-Location).Path $path
  if (Test-Path -LiteralPath $fromCwd) { return $fromCwd }
  return (Join-Path $script:root $path)
}

function Display-Width([string]$text) {
  $width = 0
  foreach ($ch in $text.ToCharArray()) {
    if ([int]$ch -ge 0x1100) { $width += 2 } else { $width += 1 }
  }
  return $width
}

function Pad-Display([string]$text, [int]$width) {
  $gap = $width - (Display-Width $text)
  if ($gap -le 0) { return $text }
  return $text + (" " * $gap)
}

function Pad-DisplayRight([string]$text, [int]$width) {
  $gap = $width - (Display-Width $text)
  if ($gap -le 0) { return $text }
  return (" " * $gap) + $text
}

function Format-Size([long]$bytes) {
  if ($bytes -ge 1GB) { return ("{0:N2} GB" -f ($bytes / 1GB)) }
  if ($bytes -ge 1MB) { return ("{0:N1} MB" -f ($bytes / 1MB)) }
  if ($bytes -ge 1KB) { return ("{0:N0} KB" -f ($bytes / 1KB)) }
  return ("{0} B" -f $bytes)
}

$script:root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $script:root "package.json"))) {
  $script:root = (Get-Location).Path
}

$version = ""
try {
  $version = (Get-Content -LiteralPath (Join-Path $script:root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
} catch {
  $version = ""
}

# ---------------------------------------------------------------- 定位目录

$installerRoot = Join-Path (Join-Path $script:root "build") "installer"

if ([string]::IsNullOrWhiteSpace($Dir)) {
  $byVersion = Join-Path $installerRoot ("Zetla_" + $version)
  if ($version -and (Test-Path -LiteralPath $byVersion -PathType Container)) {
    $Dir = $byVersion
  } else {
    $Dir = $installerRoot
  }
} else {
  $Dir = To-Abs $Dir
}

if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
  Fail ("产物目录不存在：" + $Dir + "`n    先把各平台安装包放进来，或用 -Dir 指定")
}
$script:dir = (Resolve-Path -LiteralPath $Dir).Path
while ($script:dir.Length -gt 3 -and ($script:dir.EndsWith("\") -or $script:dir.EndsWith("/"))) {
  $script:dir = $script:dir.Substring(0, $script:dir.Length - 1)
}

$fallback = $null
if (-not [string]::IsNullOrWhiteSpace($FallbackDir)) {
  $fb = To-Abs $FallbackDir
  if ($fb -and (Test-Path -LiteralPath $fb -PathType Container) -and ($fb -ne $script:dir)) {
    $fallback = (Resolve-Path -LiteralPath $fb).Path
  }
}

# ---------------------------------------------------------------- 扫描产物

$archives = @()
$files = @()
$skippedNames = @("SHA256SUMS", "SHA256SUMS.txt", "SHA256.md", ".DS_Store", "Thumbs.db", "desktop.ini")

foreach ($item in (Get-ChildItem -LiteralPath $script:dir -Recurse -File)) {
  $name = $item.Name
  if ($skippedNames -contains $name) { continue }
  if ($name.StartsWith("SHA256SUMS")) { continue }
  if ($name.StartsWith(".")) { continue }
  if ($item.FullName -match "[\\/]__MACOSX[\\/]") { continue }

  $rel = ($item.FullName.Substring($script:dir.Length) -replace '^[\\/]+', '')

  # CI artifact 压缩包不是发布产物，不参与哈希，只提示解压
  $ext = [System.IO.Path]::GetExtension($name).ToLowerInvariant()
  if ($ext -eq ".zip" -or $ext -eq ".7z" -or $ext -eq ".rar") {
    $archives += [pscustomobject]@{ Rel = $rel; Full = $item.FullName; Size = $item.Length }
    continue
  }

  $files += [pscustomobject]@{
    Name = $name
    Rel  = $rel
    Full = $item.FullName
    Size = $item.Length
    Hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
    From = $script:dir
  }
}
$files = @($files | Sort-Object Rel)

# 同一个文件名出现多份（CI artifact 解压出 macos\ 与根目录各一份很常见）：
# 只按第一个算，但必须核对内容是否一致 —— 不一致说明拿错了包。
$unique = @()
$duplicates = @()
$seenNames = @{}
foreach ($f in $files) {
  if ($seenNames.ContainsKey($f.Name)) {
    $duplicates += $f
    continue
  }
  $seenNames[$f.Name] = $f
  $unique += $f
}

# -Json 只输出机器可读内容，不要表头/提示混进去
if ($Json) {
  $map = [ordered]@{}
  foreach ($f in $unique) { $map[$f.Name] = $f.Hash }
  ConvertTo-Json -InputObject $map -Depth 3
  exit 0
}

Write-Output ""
Write-Output ("Zetla " + $(if ($version) { $version } else { "(未知版本)" }) + "  ·  " + $script:dir)

# ---------------------------------------------------------------- 打印列表

$width = 24
if ($unique.Count -gt 0) {
  $maxLen = ($unique | ForEach-Object { Display-Width $_.Rel } | Measure-Object -Maximum).Maximum
  if ($maxLen -gt $width) { $width = $maxLen }
  Write-Output ("  " + (Pad-Display "名称" $width) + "  " + (Pad-DisplayRight "大小" 9) + "  SHA256")
  Write-Output ("  " + ("-" * ($width + 9 + 64 + 4)))
  foreach ($f in $unique) {
    Write-Output ("  " + (Pad-Display $f.Rel $width) + "  " + (Pad-DisplayRight (Format-Size $f.Size) 9) + "  " + $f.Hash)
  }
} else {
  Write-Output "  目录里没有可计算的安装包"
}

if ($duplicates.Count -gt 0) {
  Write-Output ""
  Write-Output "  同名文件出现多份（按第一份算，清单用文件名匹配）："
  foreach ($d in $duplicates) {
    $first = $seenNames[$d.Name]
    if ($first.Hash -eq $d.Hash) {
      Write-Output ("    [--] " + $d.Rel + "  与 " + $first.Rel + " 内容一致，忽略")
    } else {
      Write-Output ("    [XX] " + $d.Rel + "  与 " + $first.Rel + " 内容不一致！先确认哪个是这次的产物")
    }
  }
}

if ($archives.Count -gt 0) {
  Write-Output ""
  Write-Output "  发现压缩包（脚本只算文件本身，不解压）："
  foreach ($a in $archives) {
    Write-Output ("    " + $a.Rel + "  " + (Format-Size $a.Size))
  }
  Write-Output "    解压到本目录后重跑："
  Write-Output ("    Expand-Archive -LiteralPath `"" + $archives[0].Full + "`" -DestinationPath `"" + $script:dir + "`" -Force")
}

# ---------------------------------------------------------------- SHA256SUMS

if (-not $NoSumFile -and -not $Json -and $unique.Count -gt 0) {
  if ([string]::IsNullOrWhiteSpace($Out)) {
    $sumPath = Join-Path $script:dir "SHA256SUMS"
  } else {
    $sumPath = To-Abs $Out
  }
  $lines = @()
  foreach ($f in $unique) {
    # 两个空格 + 相对路径：与 CI 里 `sha256sum <file>` 的输出一致
    $lines += ($f.Hash + "  " + $f.Rel)
  }
  $sumText = ($lines -join "`n") + "`n"
  $sumDir = Split-Path -Parent $sumPath
  if ($sumDir -and -not (Test-Path -LiteralPath $sumDir -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $sumDir -Force)
  }
  [System.IO.File]::WriteAllText($sumPath, $sumText, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output ""
  Write-Output ("  SHA256SUMS -> " + $sumPath)
}

# ---------------------------------------------------------------- 清单条目

function Add-UrlSet($list, $arr, [string]$tag) {
  if ($null -eq $arr) { return }
  foreach ($item in @($arr)) {
    if ($null -eq $item) { continue }
    $url = $item.url
    if ([string]::IsNullOrWhiteSpace($url)) { continue }
    $url = [string]$url
    $parts = $url -split "/"
    [void]$list.Add([pscustomobject]@{
      Tag  = $tag
      Name = $parts[$parts.Count - 1]
      Sha  = [string]$item.sha256
    })
  }
}

function Get-Expected($doc) {
  $list = New-Object System.Collections.ArrayList
  Add-UrlSet $list $doc.installers "顶层 installers"
  if ($doc.platforms) {
    foreach ($platform in $doc.platforms.PSObject.Properties) {
      Add-UrlSet $list $platform.Value.installers ($platform.Name + " / installers")
      Add-UrlSet $list $platform.Value.packages ($platform.Name + " / packages")
    }
  }
  # 注意不要 `return ,$list`：那会把 ArrayList 整体当成一个对象返回，
  # 之后 `$_.Name` 触发 PowerShell 成员枚举被摊平成数组，过滤条件全部失配。
  return $list
}

function Find-Local([string]$name) {
  foreach ($f in $files) {
    if ($f.Name -eq $name) { return $f }
  }
  if ($fallback) {
    $candidate = Join-Path $fallback $name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $item = Get-Item -LiteralPath $candidate
      return [pscustomobject]@{
        Name = $name
        Rel  = $name
        Full = $item.FullName
        Size = $item.Length
        Hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
        From = $fallback
      }
    }
  }
  return $null
}

$manifestPath = To-Abs $Manifest
$hasManifest = $manifestPath -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)

if (($Patch -or $Check) -and -not $hasManifest) {
  Fail ("找不到清单：" + $manifestPath)
}

$manifestText = $null
$doc = $null
$expected = @()
$names = @()

if ($hasManifest) {
  $manifestText = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
  try {
    # 注意别叫 $json：PowerShell 变量名不分大小写，会撞上 -Json 开关
    $doc = $manifestText | ConvertFrom-Json
  } catch {
    Fail ("清单不是合法 JSON：" + $_.Exception.Message)
  }
  $expected = @(Get-Expected $doc)
  $names = @($expected | ForEach-Object { $_.Name } | Sort-Object -Unique)
}

# 本地文件解析一次，Patch 与 Check 共用（同一文件不重复算哈希）
$resolved = @{}
foreach ($name in $names) {
  $resolved[$name] = Find-Local $name
}

# ---------------------------------------------------------------- 回填清单

if ($Patch -and $hasManifest) {
  Write-Output ""
  Write-Output ("回填 " + (Split-Path -Leaf $manifestPath) + " …")

  $eol = "`n"
  if ($manifestText.Contains("`r`n")) { $eol = "`r`n" }
  $lines = @($manifestText -split "\r?\n")

  $urlRegex = [regex]'"url"\s*:\s*"([^"]+)"'
  $shaRegex = [regex]'^(\s*"sha256"\s*:\s*")([^"]*)(".*)$'
  $current = ""
  $changed = 0

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $urlMatch = $urlRegex.Match($lines[$i])
    if ($urlMatch.Success) {
      $segments = $urlMatch.Groups[1].Value -split "/"
      $current = $segments[$segments.Count - 1]
      continue
    }
    $shaMatch = $shaRegex.Match($lines[$i])
    if (-not $shaMatch.Success -or $current -eq "") { continue }

    $local = $resolved[$current]
    if ($null -eq $local) { continue }
    if ($shaMatch.Groups[2].Value -eq $local.Hash) { continue }

    $lines[$i] = $shaMatch.Groups[1].Value + $local.Hash + $shaMatch.Groups[3].Value
    $changed++
  }

  $missing = @($names | Where-Object { $null -eq $resolved[$_] })

  # 全部找到 → 占位用的 _draft 已经没有意义，连同行尾逗号一起摘掉
  if ($missing.Count -eq 0) {
    $draftIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match '^\s*"_draft"\s*:') { $draftIndex = $i; break }
    }
    if ($draftIndex -ge 0) {
      $lineEndsWithComma = $lines[$draftIndex].TrimEnd().EndsWith(",")
      $before = @()
      $after = @()
      if ($draftIndex -gt 0) { $before = @($lines[0..($draftIndex - 1)]) }
      if ($draftIndex -lt ($lines.Count - 1)) { $after = @($lines[($draftIndex + 1)..($lines.Count - 1)]) }
      $lines = @($before + $after)
      if (-not $lineEndsWithComma) {
        for ($k = $draftIndex - 1; $k -ge 0; $k--) {
          if ($lines[$k].Trim() -eq "") { continue }
          if ($lines[$k].TrimEnd().EndsWith(",")) {
            $trimmed = $lines[$k].TrimEnd()
            $lines[$k] = $trimmed.Substring(0, $trimmed.Length - 1)
          }
          break
        }
      }
      Write-Output "  已移除占位字段 _draft（本版 sha256 全部就位）"
    }
  }

  $newText = ($lines -join $eol)
  if ($newText -eq $manifestText) {
    Write-Output "  sha256 已是最新，未改动"
  } else {
    [System.IO.File]::WriteAllText($manifestPath, $newText, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output ("  已写入 {0} 处 sha256" -f $changed)
    try {
      $null = ([System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
      Write-Output "  JSON 校验通过"
    } catch {
      Fail ("回填后 JSON 不合法：" + $_.Exception.Message)
    }
  }

  foreach ($name in $missing) {
    Write-Output ("[--] 清单需要但没找到：" + $name)
  }
}

# ---------------------------------------------------------------- 核对清单

if ($Check -and $hasManifest) {
  $checkText = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
  $checkDoc = $checkText | ConvertFrom-Json
  $checkEntries = @(Get-Expected $checkDoc)

  Write-Output ""
  Write-Output "核对清单 sha256 …"

  $bad = 0
  $empty = 0
  foreach ($name in $names) {
    $local = $resolved[$name]
    $shas = @($checkEntries | Where-Object { $_.Name -eq $name } | ForEach-Object { $_.Sha })
    $unique = @($shas | Sort-Object -Unique)

    if ($null -eq $local) {
      Write-Output ("[XX] " + $name + "  文件缺失（清单里有，本地算不到）")
      $bad++
      continue
    }
    $origin = ""
    if ($local.From -ne $script:dir) { $origin = "（取自 " + $local.From + "）" }

    if ($unique.Count -eq 1 -and $unique[0] -eq "") {
      Write-Output ("[--] " + $name + "  清单里的 sha256 还是空的" + $origin)
      $empty++
      continue
    }
    if ($unique.Count -gt 1) {
      Write-Output ("[XX] " + $name + "  清单内部多条 sha256 不一致")
      foreach ($s in $unique) { Write-Output ("       " + $s) }
      $bad++
      continue
    }
    if ($unique[0] -ne $local.Hash) {
      Write-Output ("[XX] " + $name + "  sha256 不一致" + $origin)
      Write-Output ("       清单 " + $unique[0])
      Write-Output ("       实际 " + $local.Hash)
      $bad++
      continue
    }
    Write-Output ("[OK] " + $name)
  }

  Write-Output ""
  if ($bad -gt 0) {
    Write-Output ("  {0} 项不一致、{1} 项待填 —— 产物重打过就必须重跑回填/清单生成" -f $bad, $empty)
    exit 1
  }
  if ($empty -gt 0) {
    Write-Output ("  {0} 项待填：加 -Patch 回填" -f $empty)
    exit 1
  }
  Write-Output "  全部一致"
}

if (-not $Patch -and -not $Check -and $unique.Count -gt 0) {
  Write-Output ""
  Write-Output "  加 -Patch 回填 latest.json，加 -Check 只核对"
}

Write-Output ""
exit 0
