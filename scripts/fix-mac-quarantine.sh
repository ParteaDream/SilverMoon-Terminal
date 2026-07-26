#!/bin/bash
# ── SilverMoon Terminal macOS 解隔离脚本 ──
# macOS Gatekeeper 会阻止未签名/未公证的应用。
# 运行此脚本可移除隔离属性并执行 ad-hoc 签名，让应用正常启动。
#
# 用法: 终端执行 bash scripts/fix-mac-quarantine.sh
#       也可传入 .app 路径: bash scripts/fix-mac-quarantine.sh /path/to/SilverMoon-Terminal.app

set -e

APP_NAME="SilverMoon-Terminal.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_DIR/release"

# ── 解析参数 ──
INTERACTIVE=true
if [[ "$1" == "-y" ]] || [[ "$1" == "--yes" ]]; then
  INTERACTIVE=false
  shift
fi

# ── 确定 .app 路径 ──
if [ -n "$1" ]; then
  APP_PATH="$1"
elif [ -d "$RELEASE_DIR/mac-arm64/$APP_NAME" ]; then
  APP_PATH="$RELEASE_DIR/mac-arm64/$APP_NAME"
elif [ -d "$RELEASE_DIR/$APP_NAME" ]; then
  APP_PATH="$RELEASE_DIR/$APP_NAME"
elif [ -d "/Applications/$APP_NAME" ]; then
  APP_PATH="/Applications/$APP_NAME"
elif ! $INTERACTIVE; then
  echo "ℹ️  未找到 mac .app，跳过（非 macOS 或未构建 mac 版本）"
  exit 0
else
  echo "❌ 未找到 $APP_NAME"
  echo "   用法: bash scripts/fix-mac-quarantine.sh /完整/路径/SilverMoon-Terminal.app"
  exit 1
fi

echo "🔍 找到: $APP_PATH"

# ── 检查是否在 Downloads 目录（macOS 对其限制更严）──
# 自动化模式（-y）跳过交互
if $INTERACTIVE && [[ "$APP_PATH" == *"/Downloads/"* ]]; then
  echo "⚠️  应用当前在「下载」文件夹中，macOS 对其限制更严格。"
  echo "   建议移到「应用程序」文件夹："
  echo "   sudo cp -R \"$APP_PATH\" /Applications/"
  echo ""
  read -p "是否继续处理当前路径？(y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消。请将 .app 移到 /Applications 后重新运行。"
    exit 1
  fi
fi

# ── 1. 移除 quarantine 属性 ──
echo "🔓 移除 quarantine 属性..."
xattr -cr "$APP_PATH" 2>/dev/null || true
echo "   ✅ 已清除"

# ── 2. Ad-hoc 签名 ──
if command -v codesign &>/dev/null; then
  echo "🔑 执行 ad-hoc 签名..."
  # --no-strict 避免 strict mode 下因未签名 framework 报错
  codesign --force --deep --sign - "$APP_PATH" 2>/dev/null && echo "   ✅ 签名完成" || echo "   ⚠️  签名失败（不影响运行，可跳过）"
else
  echo "⚠️  未检测到 codesign（可跳过）"
fi

echo ""
echo "🎉 处理完成！"

if $INTERACTIVE; then
  echo ""
  echo "⚠️  重要：请务必右键点击 $APP_NAME →「打开」（不要双击！）"
  echo "   首次右键打开会弹出确认对话框，点击「打开」即可。"
  echo "   之后就可以正常双击启动了。"
  echo ""
  echo "   如果仍然被阻止，请去："
  echo "   系统设置 → 隐私与安全性 → 安全性，点击「仍然允许」。"
fi
echo ""
