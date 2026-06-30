<#
.SYNOPSIS
  生成自签名代码签名证书用于 Windows 构建。
  生成的证书将保存到 cert/silvermoon.pfx。

.NOTES
  自签名证书不能绕过 Smart App Control（需要 CA 颁发的证书）。
  但可以让 Windows 显示发布者名称、减轻 SmartScreen 警告。
  如需完全绕过 Smart App Control，请购买代码签名证书。
#>

$certDir = Join-Path $PSScriptRoot ".." "cert"
$pfxPath = Join-Path $certDir "silvermoon.pfx"
$password = "silvermoon-codesign-2024"

# 创建 cert 目录
if (-not (Test-Path $certDir)) {
    New-Item -ItemType Directory -Path $certDir | Out-Null
    Write-Host "创建目录: $certDir"
}

# 检查是否已存在
if (Test-Path $pfxPath) {
    Write-Host "证书已存在: $pfxPath"
    Write-Host "如需重新生成，请先删除该文件。"
    exit 0
}

# 生成自签名代码签名证书
Write-Host "正在生成自签名代码签名证书..."
$cert = New-SelfSignedCertificate `
    -Subject "CN=SilverMoon Terminal, O=SilverMoon, C=CN" `
    -FriendlyName "SilverMoon Terminal Code Signing" `
    -Type CodeSigning `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(5)

if (-not $cert) {
    Write-Error "证书生成失败"
    exit 1
}

# 导出为 PFX
$securePass = ConvertTo-SecureString -String $password -Force -AsPlainText
Export-PfxCertificate -Cert $cert.Thumbprint -FilePath $pfxPath -Password $securePass | Out-Null

Write-Host "证书已生成: $pfxPath"
Write-Host "指纹 (Thumbprint): $($cert.Thumbprint)"
Write-Host ""
Write-Host "构建命令（设置环境变量后执行）："
Write-Host '  $env:CSC_LINK = "' + $pfxPath + '"'
Write-Host '  $env:CSC_KEY_PASSWORD = "' + $password + '"'
Write-Host '  npm run electron:build:win'
Write-Host ""
Write-Host "提示：将证书安装到 '受信任的根证书颁发机构' 可完全信任此应用。"
Write-Host "但其他用户仍需手动安装证书或购买 CA 颁发的证书。"
