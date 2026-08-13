#!/usr/bin/env bash
# Installs the SKUForge nightly scan cron on the VPS. Idempotent — safe to re-run
# after every deploy that changes anything in ops/cron/.
#
#   sudo bash ops/cron/install.sh
#
# Prerequisite: /etc/vps-apps/skuforge.env must already define SHOPIFY_APP_URL and
# CRON_SECRET. This script does not create or modify that file.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=/etc/vps-apps/skuforge.env

if [ "$(id -u)" -ne 0 ]; then
  echo "Must run as root (the targets live under /etc and /usr/local/bin)." >&2
  exit 1
fi

for key in SHOPIFY_APP_URL CRON_SECRET; do
  if ! grep -qE "^${key}=." "$ENV_FILE" 2>/dev/null; then
    echo "ERROR: ${key} is missing from ${ENV_FILE}. Set it before installing." >&2
    exit 1
  fi
done

install -m 0700 -o root -g root "$SRC/skuforge-cron-scan.sh" /usr/local/bin/skuforge-cron-scan.sh
# cron refuses to run a crontab that is group- or world-writable.
install -m 0644 -o root -g root "$SRC/skuforge-scan.cron" /etc/cron.d/skuforge-scan
install -m 0644 -o root -g root "$SRC/skuforge-cron.logrotate" /etc/logrotate.d/skuforge-cron

touch /var/log/skuforge-cron.log
chmod 0640 /var/log/skuforge-cron.log

echo "Installed. Verify with a manual run (this performs a real scan):"
echo "  /usr/local/bin/skuforge-cron-scan.sh"
echo "A second run the same UTC day must report skipped_already_scanned."
