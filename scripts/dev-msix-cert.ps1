# dev-msix-cert.ps1 — 本地自签名代码签名证书（仅供 AppX/MSIX 打包与侧载荷验证）
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev-msix-cert.ps1
#
# 产出 build/bitjarvis-dev.pfx（含私钥，签名用）与 build/bitjarvis-dev.cer（公钥，信任用）。
# 证书 Subject 必须与 package.json 里 build.appx.publisher 逐字一致，否则安装会报
# “此应用包或捆绑包的发布者与签名证书的发布者不匹配”。
#
# 用法：
#   $env:CSC_LINK = "<repo>\build\bitjarvis-dev.pfx"
#   $env:CSC_KEY_PASSWORD = "bitjarvis"
#   npm run dist:win:appx
# 侧加载验证前，把 .cer 放进信任存储（二选一，前者需要管理员）：
#   Import-Certificate -FilePath build\bitjarvis-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
#   Import-Certificate -FilePath build\bitjarvis-dev.cer -CertStoreLocation Cert:\CurrentUser\TrustedPeople
#
# 正式上架 Microsoft Store 不需要这个证书：商店会用微软的证书重新签名，
# 届时把 build.appx.publisher 换成 Partner Center 预留的身份三件套，并去掉 CSC_LINK。
#
# 这个证书只用于本机验证，不要用它分发任何东西：自签名在 SmartScreen 眼里等同未签名。
#
# 商店提交包用另一张同款自签证书，Subject 换成 Partner Center 预留的 Publisher：
#   npm run generate:appx-store-cert
#   （等价于 -Subject "CN=<预留 Publisher>" -Name bitjarvis-store）
# 商店会在认证通过后用微软的证书重新签名，所以这张证书信不信得过都无所谓；
# 它唯一的硬约束是 Subject 必须与包内 Identity/Publisher 逐字一致，否则签不出来。

param(
  [string]$Subject = "CN=Bit Jarvis Dev",
  [string]$Name = "bitjarvis-dev",
  [string]$Password = "bitjarvis",
  [string]$FriendlyName = "Bit Jarvis Dev Code Signing"
)

$ErrorActionPreference = "Stop"

$subject = $Subject
$password = $Password
$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot "build"
$pfx = Join-Path $targetDir "$Name.pfx"
$cer = Join-Path $targetDir "$Name.cer"

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$cert = $null

# 首选系统 cmdlet。受限环境（无权限写用户密钥库，报 NTE_PERM）下失败，回落 .NET 内存生成。
try {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject `
    -CertStoreLocation Cert:\CurrentUser\My -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(3) `
    -FriendlyName $FriendlyName
  Write-Host "created via New-SelfSignedCertificate"
} catch {
  Write-Host "New-SelfSignedCertificate unavailable ($($_.Exception.Message)); using .NET CertificateRequest"
}

if (-not $cert) {
  $rsa = [System.Security.Cryptography.RSA]::Create(2048)
  $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest(
    $subject,
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)

  $ekuOids = New-Object System.Security.Cryptography.OidCollection
  [void]$ekuOids.Add((New-Object System.Security.Cryptography.Oid("1.3.6.1.5.5.7.3.3")))  # codeSigning
  $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($ekuOids, $false)))
  $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($false, $false, 0, $false)))
  $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $false)))

  $cert = $req.CreateSelfSigned((Get-Date).AddDays(-1), (Get-Date).AddYears(3))
  Write-Host "created via .NET CertificateRequest"
}

[System.IO.File]::WriteAllBytes($pfx, $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password))
[System.IO.File]::WriteAllBytes($cer, $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))

Write-Host "pfx:        $pfx"
Write-Host "cer:        $cer"
Write-Host "subject:    $($cert.Subject)"
Write-Host "thumbprint: $($cert.Thumbprint)"
Write-Host ""
Write-Host "CSC_LINK=$pfx"
Write-Host "CSC_KEY_PASSWORD=$password"