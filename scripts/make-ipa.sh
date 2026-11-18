#!/usr/bin/env bash
# 把 xcodebuild 产出的 .app 打包成未签名 IPA（Payload/ + zip）。
# 用法: bash scripts/make-ipa.sh [.app 路径] [输出目录]
set -euo pipefail

APP_PATH="${1:-build/Build/Products/Release-iphoneos/FHCpeBoard.app}"
OUT_DIR="${2:-dist}"
NAME="FHCpeBoard-1.4.3-local-52-unsigned"

if [ ! -d "$APP_PATH" ]; then
  echo "找不到 .app: $APP_PATH" >&2
  exit 1
fi

rm -rf "$OUT_DIR/Payload" "$OUT_DIR/$NAME.ipa"
mkdir -p "$OUT_DIR/Payload"
cp -R "$APP_PATH" "$OUT_DIR/Payload/"

# 去掉可能残留的签名痕迹，避免自签工具重复签名冲突。
APP_BUNDLE="$OUT_DIR/Payload/$(basename "$APP_PATH")"
rm -rf "$APP_BUNDLE/_CodeSignature" "$APP_BUNDLE/embedded.mobileprovision"

( cd "$OUT_DIR" && zip -qry "$NAME.ipa" Payload )

SIZE=$(du -h "$OUT_DIR/$NAME.ipa" | cut -f1)
echo "已生成: $OUT_DIR/$NAME.ipa ($SIZE)"
