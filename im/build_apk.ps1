# 打包 Android release APK（按 CPU 架构自动拆分），并拷贝到输出目录
# 用法:  .\build_apk.ps1 [-OutDir D:\Code\IM]  （可选 -Simulator 附带 x86_64 模拟器包）
# 说明:
#   - 架构拆包用官方推荐的 --split-per-abi，配合 --target-platform 只打真机用的 arm 架构
#     （Flutter 3.35+ 会自动注入 abiFilters，android/app/build.gradle.kts 里不要再手写或加 splits，否则 gradle 报 Conflicting configuration）
#   - FLUTTER_PREBUILT_ENGINE_VERSION 用于绕开非 git 安装的 Flutter SDK 的版本探测 bug
param(
    [string]$OutDir = "D:\Code\IM",
    [switch]$Simulator
)

$ErrorActionPreference = "Stop"
$flutterRoot = "D:\Code\flutter"

# 绕开 flutter SDK 脚本在非 git 安装下的崩溃 (update_engine_version.ps1)
$engineVersion = Get-Content "$flutterRoot\bin\internal\engine.version"
$env:FLUTTER_PREBUILT_ENGINE_VERSION = $engineVersion.Trim()

$targetPlatform = "android-arm64,android-arm"
if ($Simulator) { $targetPlatform += ",android-x64" }

Write-Host "==> flutter build apk --release --split-per-abi --target-platform $targetPlatform"
flutter build apk --release --split-per-abi --target-platform $targetPlatform
if ($LASTEXITCODE -ne 0) { throw "Flutter 构建失败" }

$src = Join-Path (Get-Location) "build\app\outputs\flutter-apk"
Get-ChildItem "$src\app-*-release.apk" | ForEach-Object {
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    # app-arm64-v8a-release.apk -> bitjarvis-im-arm64-v8a.apk
    $destName = "bitjarvis-im-" + ($_.Name -replace '^app-(.*)-release\.apk$', '$1') + ".apk"
    Copy-Item $_.FullName (Join-Path $OutDir $destName) -Force
    Write-Host "==> 已复制: $(Join-Path $OutDir $destName) ($([math]::Round($_.Length/1MB,1)) MB)"
}
Write-Host "完成。"