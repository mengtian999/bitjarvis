# SPDX-FileCopyrightText: 2019-Present Contributors to BitJarvis
#
# SPDX-License-Identifier: Apache-2.0

# Build FluffyChat (bitjarvis) as a Flutter Web app for embedding in the
# Jarvis desktop Electron app via an iframe served at /im/.
#
# Stage 1 (no E2E encryption): skip vodozemac / native_executor compilation.
# Just build the web bundle directly. This is sufficient for the "pure IM
# client" milestone (P0) where Agent integration is not yet wired up.
#
# When E2E is needed later, port the steps from scripts/prepare-web.sh:
#   1. Clone dart-vodozemac, compile WASM via flutter_rust_bridge_codegen
#   2. dart compile js web/native_executor.dart -o web/native_executor.js
#   3. Download native_imaging web bundle
# Then run this build.

$ErrorActionPreference = "Stop"

# Resolve repo root (im/) regardless of where the script is invoked from.
$imDir = Split-Path -Parent $PSScriptRoot
Set-Location $imDir

Write-Host "[build-web] Flutter Web build for bitjarvis IM"
Write-Host "[build-web] Working directory: $(Get-Location)"

# Ensure dependencies are up to date.
Write-Host "[build-web] flutter pub get..."
flutter pub get
if ($LASTEXITCODE -ne 0) {
    throw "flutter pub get failed (exit $LASTEXITCODE)"
}

# Build the web bundle. --base-href must be "/im/" because the Jarvis server
# serves the Flutter web app under the /im/ path (see server/routes/mobile-static.ts).
#
# --no-wasm-dry-run: the project uses universal_html / flutter_rust_bridge which
# emit Wasm-compatibility warnings on stderr. These are non-fatal (the JS build
# still succeeds), but PowerShell treats stderr output as an error stream which
# flips $LASTEXITCODE. Disabling the dry run avoids the noise.
Write-Host "[build-web] flutter build web --release --base-href /im/ ..."
flutter build web --release --base-href "/im/" --no-wasm-dry-run
if ($LASTEXITCODE -ne 0) {
    throw "flutter build web failed (exit $LASTEXITCODE)"
}

$outputDir = Join-Path (Join-Path $imDir "build") "web"
if (Test-Path (Join-Path $outputDir "index.html")) {
    Write-Host "[build-web] Done. Output: $outputDir"
} else {
    throw "Build completed but index.html not found at $outputDir"
}
