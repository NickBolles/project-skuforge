#!/usr/bin/env bash
# Installs the SKUForge encrypted nightly database backup on the VPS. Idempotent —
# safe to re-run after every deploy that changes anything in ops/backup/.
#
#   sudo bash ops/backup/install.sh
#
# Generates /etc/vps-apps/skuforge-backup.key on first run and never touches it
# again. Rotating that key by hand orphans every backup taken before the change,
# so if you rotate it, keep the old key for as long as you keep the old backups.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE=/etc/vps-apps/skuforge-backup.key

if [ "$(id -u)" -ne 0 ]; then
  echo "Must run as root (the targets live under /etc, /usr/local/bin, and /var/backups)." >&2
  exit 1
fi

if [ -s "$KEY_FILE" ]; then
  echo "Key already present at $KEY_FILE — left untouched."
else
  # Written with a restrictive umask rather than chmod-after-write, so the key is
  # never briefly readable on disk.
  ( umask 077; openssl rand -base64 48 > "$KEY_FILE" )
  chown root:root "$KEY_FILE"
  echo "Generated a new encryption key at $KEY_FILE."
  echo
  echo "  ⚠️  COPY IT OFF THIS HOST NOW. Every backup is unreadable without it,"
  echo "      and a key stored only on the machine being backed up protects"
  echo "      against nothing. Store it wherever SHOPIFY_API_SECRET lives."
  echo
fi

install -m 0700 -o root -g root "$SRC/skuforge-backup.sh" /usr/local/bin/skuforge-backup.sh
# cron refuses to run a crontab that is group- or world-writable.
install -m 0644 -o root -g root "$SRC/skuforge-backup.cron" /etc/cron.d/skuforge-backup

install -d -m 0700 -o root -g root /var/backups/skuforge

echo "Installed. Verify with a manual run (this writes a real backup):"
echo "  /usr/local/bin/skuforge-backup.sh"
echo "Then confirm the output actually decrypts — see docs/BACKUPS.md."
