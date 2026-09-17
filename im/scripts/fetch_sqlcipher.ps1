# 手动补齐 sqlite3 pub hook 需要的 SQLCipher 预编译库
#
# 背景:
#   sqlite3 3.5.0 的 pub hook (hooks.user_defines.sqlite3.source: sqlcipher) 会从
#   https://github.com/simolus3/sqlite3.dart/releases/download/sqlite3-3.5.0/<file>
#   下载预编译的 libsqlcipher.so。国内直连 GitHub Releases 极慢(实测 14 分钟仅 3.7MB)，
#   会导致 flutter build apk 长时间挂起、CPU 接近 0、看起来像"卡死"。
#
#   hook 的缓存逻辑(lib/src/hook/compile/description.dart 的 downloadIntoOutputDirectoryShared):
#     <outputDirectoryShared>/download-<sha256前8位>/libsqlcipher.so
#   若该文件已存在且 sha256 与 asset_hashes.dart 中登记的期望值一致，hook 直接复用、不再下载。
#   因此本脚本把文件放到对应目录即可让构建跳过网络下载。
#
# 用法:  .\scripts\fetch_sqlcipher.ps1 [-Proxy https://ghproxy.net/]
param(
    [string]$Proxy = "https://ghproxy.net/",
    [int]$MaxTry = 8
)

$ErrorActionPreference = "Continue"

# 缓存根目录: <project>/.dart_tool/hooks_runner/shared/sqlite3/build
$base = Join-Path (Split-Path $PSScriptRoot -Parent) ".dart_tool\hooks_runner\shared\sqlite3\build"
$tag  = "sqlite3-3.5.0"

# dir 名 = download-<sha256前8位>; expect 来自 sqlite3-3.5.0/lib/src/hook/asset_hashes.dart
$jobs = @(
    @{ file = "libsqlcipher.arm64.android.so"; dir = "download-aab3ca74"; expect = "aab3ca747d6fd64ab20d6cea8de09009e2117d2943b5f0d577d8a371fa9f264b"; size = 5740896 },
    @{ file = "libsqlcipher.arm.android.so";   dir = "download-92db9f41"; expect = "92db9f415dc91ad19620089f5d57ab8feb3f6e26def18aa90de699d9691a6b66"; size = 0 }
)

New-Item -ItemType Directory -Force $base | Out-Null

foreach ($j in $jobs) {
    $dir  = Join-Path $base $j.dir
    $dest = Join-Path $dir "libsqlcipher.so"
    New-Item -ItemType Directory -Force $dir | Out-Null
    Remove-Item $dest, "$dest.tmp" -Force -ErrorAction SilentlyContinue

    $url = $Proxy + "https://github.com/simolus3/sqlite3.dart/releases/download/$tag/$($j.file)"
    Write-Host "==> $($j.file) => $dest" -ForegroundColor Cyan

    for ($i = 1; $i -le $MaxTry; $i++) {
        $have = if (Test-Path $dest) { (Get-Item $dest).Length } else { 0 }
        # -C - 断点续传; -sS 静默但保留错误; --retry 交给 curl 内部重试
        & curl.exe -sS -L -C - -o $dest --connect-timeout 20 --max-time 900 `
            --retry 3 --retry-delay 2 --retry-all-errors --no-progress-meter $url
        $code = $LASTEXITCODE
        $have = if (Test-Path $dest) { (Get-Item $dest).Length } else { 0 }

        $ok = $false
        if ($code -eq 0 -and $have -gt 0) {
            $hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
            $ok = ($hash -eq $j.expect)
            if ($ok) { $sizeNote = "$have bytes" } else { $sizeNote = "$have bytes, hash=$hash" }
        } else {
            $sizeNote = "curl exit=$code, $have bytes"
        }

        Write-Host ("    try #{0}: {1}" -f $i, $sizeNote)
        if ($ok) {
            Write-Host "    OK  sha256 校验通过" -ForegroundColor Green
            break
        }
        if ($i -eq $MaxTry) {
            Write-Host "    失败: 达到最大尝试次数，哈希不匹配" -ForegroundColor Red
        }
    }
}

Write-Host "`n=== 结果校验 ===" -ForegroundColor Cyan
foreach ($j in $jobs) {
    $dest = Join-Path (Join-Path $base $j.dir) "libsqlcipher.so"
    if (!(Test-Path $dest) -or (Get-Item $dest).Length -eq 0) {
        Write-Host ("MISSING  {0}" -f $j.dir) -ForegroundColor Red
        continue
    }
    $hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
    $size = (Get-Item $dest).Length
    if ($hash -eq $j.expect) {
        Write-Host ("OK       {0}  {1:N0} bytes" -f $j.dir, $size) -ForegroundColor Green
    } else {
        Write-Host ("BADHASH  {0}  got={1} want={2}" -f $j.dir, $hash, $j.expect) -ForegroundColor Red
    }
}
