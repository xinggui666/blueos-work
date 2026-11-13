#!/bin/sh
# 用蓝河官方命令行工具链（blueos-toolkit，命令名 bot）把工坊导出的源工程 zip 编译成 RPK。
#
# 用法：
#   BLUEOS_TOOLKIT_TGZ=/path/blueos-toolkit-1.9.45-beta.44.tgz \
#   BLUEOS_RPK_SIGN_DIR=/path/rpk-sign            # 含 private.pem + certificate.pem；不设则只出 debug 包
#   sh scripts/build-rpk.sh <源工程.zip> <输出目录>
#
# 说明：
# - 工具链不随仓库分发（来自蓝河 SDK 包），由运维自行放置。
# - webpack 固定 5.89.0：更新的 webpack 删除了 webpack/lib/EntryOptionPlugin，toolkit 1.9.45 会报错。
# - release 签名是开发者自己用 openssl 生成的 pem（与 BlueOS Studio「打包→生成签名」一致），绝不进仓库。
set -eu
src_zip="${1:?源工程 zip}"
out_dir="${2:?输出目录}"
: "${BLUEOS_TOOLKIT_TGZ:?需要 BLUEOS_TOOLKIT_TGZ 指向 blueos-toolkit 的 tgz}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/tool" "$work/app" "$out_dir"
( cd "$work/tool" && npm init -y >/dev/null && npm install --no-audit --no-fund --silent "$BLUEOS_TOOLKIT_TGZ" webpack@5.89.0 >/dev/null )
( cd "$work/app" && unzip -q "$src_zip" )
bot="$work/tool/node_modules/.bin/bot"
( cd "$work/app" && "$bot" build )
if [ -n "${BLUEOS_RPK_SIGN_DIR:-}" ]; then
  mkdir -p "$work/app/sign"
  cp "$BLUEOS_RPK_SIGN_DIR/private.pem" "$BLUEOS_RPK_SIGN_DIR/certificate.pem" "$work/app/sign/"
  ( cd "$work/app" && "$bot" release )
  rm -rf "$work/app/sign"
fi
find "$work/app/dist" -name '*.rpk' -exec cp {} "$out_dir/" \;
( cd "$out_dir" && sha256sum *.rpk )
