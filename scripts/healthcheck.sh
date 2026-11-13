#!/bin/sh
# No secrets in arguments/output. Use a loopback/internal URL; expose only through trusted monitoring.
set -eu
url="${HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/health}"
curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "$url"
printf '\n'
