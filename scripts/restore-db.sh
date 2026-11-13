#!/bin/sh
# 从 backup-db.sh 生成的备份恢复数据库。
# 用法：DATABASE_URL=postgres://... sh scripts/restore-db.sh backups/blueos-YYYYmmddTHHMMSSZ.dump
# 会先清空目标库里同名对象（--clean --if-exists），请确认目标库正确，并先停止应用。
set -eu
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi
file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "usage: DATABASE_URL=... sh scripts/restore-db.sh <backup.dump>" >&2
  exit 1
fi
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction -d "$DATABASE_URL" "$file"
echo "restored $file"
