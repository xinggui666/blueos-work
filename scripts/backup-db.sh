#!/bin/sh
# Usage: DATABASE_URL=postgres://... sh scripts/backup-db.sh
set -eu
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DATABASE_URL" --format=custom --file "backups/blueos-$stamp.dump"
echo "backups/blueos-$stamp.dump"
