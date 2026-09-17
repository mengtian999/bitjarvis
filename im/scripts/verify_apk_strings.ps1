# Verify strings inside the AOT snapshot (libapp.so) of a Flutter release APK.
#
# Key point: Flutter Android release builds compile Dart code into libapp.so
# (AOT snapshot), NOT into the dex files. l10n strings live there too.
#
# Usage:
#   .\scripts\verify_apk_strings.ps1 -ApkPath 'D:\Code\IM\Jarvis\bitjarvis-im-arm64-v8a.apk'
#   .\scripts\verify_apk_strings.ps1 -ApkPath 'D:\Code\IM\Jarvis\bitjarvis-im-armeabi-v7a.apk' -Abi armeabi-v7a
#
# Non-ASCII needles are built from code points (Get-CpStr) so that no source
# file or console encoding can corrupt them.
param(
    [string]$ApkPath = 'D:\Code\IM\Jarvis\bitjarvis-im-arm64-v8a.apk',
    [string]$Abi = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
$apk = Resolve-Path $ApkPath
$work = Join-Path $env:TEMP ('apkvf_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null

# Build a string from Unicode code points. Astral-plane code points are
# expanded to UTF-16 surrogate pairs.
function Get-CpStr([int[]]$cps) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($cp in $cps) {
        if ($cp -lt 0x10000) {
            [void]$sb.Append([char]$cp)
        } else {
            $v = $cp - 0x10000
            [void]$sb.Append([char](0xD800 + [int]($v -shr 10)))
            [void]$sb.Append([char](0xDC00 + ($v -band 0x3FF)))
        }
    }
    return $sb.ToString()
}

try {
    $libso = 'lib/' + $Abi + '/libapp.so'
    & tar.exe -xf $apk -C $work $libso 2>&1 | Out-Null
    $soPath = Join-Path $work $libso
    if (-not (Test-Path $soPath)) {
        throw ('not found in APK: ' + $libso)
    }

    $bytes = [IO.File]::ReadAllBytes($soPath)
    # Decode once, then rely on the native String.Contains (O(n)).
    $utf8 = [Text.Encoding]::UTF8.GetString($bytes)

    Write-Host ('libapp.so = {0:N0} bytes' -f $bytes.Length)
    Write-Host ''

    $needles = [ordered]@{
        'asset path (new)'        = 'assets/recommended_homeservers.json'
        'fallback log (new)'      = 'Unable to load remote homeserver list'
        'recovery key file (new)' = 'BitJarvis-Recovery-Key'
        'issue URL (new)'         = 'mengtian999/bitjarvis'
        'backup ext (new)'        = 'bitjarvisbackup'
        'OLD invite domain'       = 'fluffychat.im'
        'OLD recovery key file'   = 'FluffyChat-Recovery-Key'
        'OLD backup ext'          = 'fluffybackup'
        'OLD upstream repo'       = 'krille-chan/fluffychat'
        'probe emoji U+1F4AC'     = Get-CpStr @(0x1F4AC)
        'probe thumbup U+1F44D'   = Get-CpStr @(0x1F44D)
        'probe heart U+2764'      = Get-CpStr @(0x2764)
        'probe ja "message"'      = Get-CpStr @(0x30E1, 0x30FC, 0x30B7, 0x30EC, 0x30FC, 0x30B8, 0x30E5)
        'probe ko "new message"'  = Get-CpStr @(0xD0C0, 0xEA4D, 0xC77C, 0xD55C, 0xC988)
        'probe ko "invited"'      = Get-CpStr @(0xD0C0, 0xD654, 0xC774, 0xB3C4, 0xB2E4, 0xD588, 0xB2E4, 0xB9AC, 0xB2C8)
        'probe Bit Jarvis'        = 'Bit Jarvis'
    }

    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    foreach ($k in $needles.Keys) {
        '{0,-28} {1}' -f $k, $(if ($utf8.Contains($needles[$k])) { 'PRESENT' } else { 'ABSENT  ' })
    }
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
