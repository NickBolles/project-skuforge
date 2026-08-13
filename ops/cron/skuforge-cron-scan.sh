#!/usr/bin/env bash
# Nightly SKUForge duplicate scan. See docs/CRON.md.
# Idempotent per UTC day: a second call the same day returns skipped_already_scanned.
set -euo pipefail
ENV_FILE=/etc/vps-apps/skuforge.env
# tr -d '\r': the env file has CRLF line endings; a stray CR corrupts the header.
APP_URL="$(grep -E '^SHOPIFY_APP_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | xargs)"
SECRET="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | xargs)"
if [ -z "${APP_URL}" ] || [ -z "${SECRET}" ]; then
  echo "$(date -u +%FT%TZ) ERROR: SHOPIFY_APP_URL or CRON_SECRET missing from ${ENV_FILE}" >&2
  exit 1
fi
CODE="$(curl -sS -o /tmp/skuforge-cron-body.txt -w '%{http_code}' \
  --max-time 600 --retry 3 --retry-delay 30 --retry-connrefused \
  -X POST -H "Authorization: Bearer ${SECRET}" "${APP_URL}/api/cron/scan")"
echo "$(date -u +%FT%TZ) http=${CODE} $(head -c 500 /tmp/skuforge-cron-body.txt)"
rm -f /tmp/skuforge-cron-body.txt
[ "${CODE}" = "200" ] || exit 1
