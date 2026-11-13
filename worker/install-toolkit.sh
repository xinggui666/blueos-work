#!/bin/sh
# 把蓝河官方命令行工具链安装到固定目录，供构建 Worker 离线使用（Worker 编译时不再联网安装）。
#   sh worker/install-toolkit.sh /path/blueos-toolkit-1.9.45-beta.44.tgz /opt/blueos-toolkit
# - toolkit tgz 来自蓝河 SDK，不随仓库分发。
# - webpack 固定 5.89.0：更新的 webpack 删除了 webpack/lib/EntryOptionPlugin，toolkit 1.9.45 会报错。
set -eu
tgz="${1:?blueos-toolkit tgz 路径}"
dir="${2:?安装目录}"
mkdir -p "$dir"
cd "$dir"
[ -f package.json ] || npm init -y >/dev/null
npm install --no-audit --no-fund --save-exact "$tgz" webpack@5.89.0
test -f node_modules/blueos-toolkit/bin/index.js
node -p "'blueos-toolkit ' + require('./node_modules/blueos-toolkit/package.json').version + ' 已安装到 ' + process.cwd()"
