#!/bin/bash
# 生成自签名代码签名证书（适用于 macOS/Linux 交叉编译 Windows 构建）
# 需要 openssl 和 osslsigncode 或 signcode

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="$SCRIPT_DIR/../cert"
PFX_PATH="$CERT_DIR/silvermoon.pfx"
PASSWORD="silvermoon-codesign-2024"

mkdir -p "$CERT_DIR"

if [ -f "$PFX_PATH" ]; then
  echo "证书已存在: $PFX_PATH"
  echo "如需重新生成，请先删除该文件。"
  exit 0
fi

echo "正在生成自签名代码签名证书..."

# 生成私钥和自签名证书
openssl req -x509 -newkey rsa:4096 -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
  -days 1825 -nodes -subj "/CN=SilverMoon Terminal/O=SilverMoon/C=CN" \
  -extensions codesign 2>/dev/null <<'EXTCODESIGN'
[codesign]
basicConstraints=CA:FALSE
keyUsage=digitalSignature
extendedKeyUsage=codeSigning
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EXTCODESIGN

# 导出为 PKCS12 (PFX)
openssl pkcs12 -export -out "$PFX_PATH" \
  -inkey "$CERT_DIR/key.pem" -in "$CERT_DIR/cert.pem" \
  -passout "pass:$PASSWORD" \
  -name "SilverMoon Terminal Code Signing"

# 清理中间文件
rm -f "$CERT_DIR/key.pem" "$CERT_DIR/cert.pem"

echo "证书已生成: $PFX_PATH"
echo ""
echo "构建命令（设置环境变量后执行）："
echo "  export CSC_LINK=\"$PFX_PATH\""
echo "  export CSC_KEY_PASSWORD=\"$PASSWORD\""
echo "  npm run electron:build:win"
echo ""
echo "注意：自签名证书仅对安装了该证书的机器有效。"
echo "如需在其他 Windows 机器上绕过 Smart App Control，请购买 CA 颁发的代码签名证书。"
