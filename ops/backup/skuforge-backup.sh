#!/usr/bin/env bash
# Encrypted nightly logical backup of the SKUForge Postgres database.
#
# Output: /var/backups/skuforge/skuforge-YYYYmmdd-HHMMSS.sql.gz.enc
# Cipher: AES-256-CBC, PBKDF2 (200k iterations), passphrase in $KEY_FILE.
#
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -salt \
#     -pass file:/etc/vps-apps/skuforge-backup.key -in <file> | gunzip \
#     | docker exec -i skuforge-db-1 psql -U skuforge -d <target_db>
#
# Restore into a scratch database first and diff it against production before
# pointing the app at it — --clean --if-exists drops objects on the way in, so
# restoring straight over a live database destroys it if the dump is bad.
#
# WARNING: the backups are worthless without /etc/vps-apps/skuforge-backup.key.
# Keep a copy of that key OFF this host. A backup encrypted with a key that
# lives only on the machine being backed up protects against nothing.
set -euo pipefail

CONTAINER=skuforge-db-1
DB_USER=skuforge
DB_NAME=skuforge
DEST=/var/backups/skuforge
KEY_FILE=/etc/vps-apps/skuforge-backup.key
KEEP_DAYS=14

log() { echo "$(date -u +%FT%TZ) skuforge-backup: $*"; }

[ -r "$KEY_FILE" ] || { log "FATAL: missing key file $KEY_FILE"; exit 1; }
docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -qx true \
  || { log "FATAL: $CONTAINER is not running"; exit 1; }

mkdir -p "$DEST"
chmod 700 "$DEST"

STAMP=$(date -u +%Y%m%d-%H%M%S)
TMP="$DEST/.skuforge-$STAMP.partial"
OUT="$DEST/skuforge-$STAMP.sql.gz.enc"

# pipefail makes a pg_dump failure fail the whole pipeline, so a truncated dump
# can never be promoted to a real backup filename.
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -pass "file:$KEY_FILE" -out "$TMP"

mv "$TMP" "$OUT"
chmod 600 "$OUT"
log "wrote $OUT ($(stat -c %s "$OUT") bytes)"

DELETED=$(find "$DEST" -name 'skuforge-*.sql.gz.enc' -mtime "+$KEEP_DAYS" -print -delete | wc -l)
find "$DEST" -name '.skuforge-*.partial' -mmin +120 -delete
log "retention: removed $DELETED backup(s) older than $KEEP_DAYS days; $(find "$DEST" -name 'skuforge-*.sql.gz.enc' | wc -l) retained"
