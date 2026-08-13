# Database backups

Encrypted nightly logical backups of the SKUForge Postgres database, running on the VPS.

| | |
|---|---|
| **Schedule** | 03:37 UTC daily (`/etc/cron.d/skuforge-backup`) |
| **Script** | `/usr/local/bin/skuforge-backup.sh` (source: `ops/backup/skuforge-backup.sh`) |
| **Output** | `/var/backups/skuforge/skuforge-YYYYmmdd-HHMMSS.sql.gz.enc`, mode `600`, dir `700` |
| **Cipher** | AES-256-CBC, PBKDF2, 200,000 iterations, salted |
| **Key** | `/etc/vps-apps/skuforge-backup.key`, mode `600` |
| **Retention** | 14 days |
| **Logs** | syslog — `journalctl -t skuforge-backup` |

03:37 is twenty minutes after the nightly scan at 03:17 (see `docs/CRON.md`), so the backup
captures the state the scan left behind rather than racing it.

This mirrors the AlertProof backup already running on the same host, deliberately — one restore
procedure covers both apps.

## Install / update

```bash
sudo bash ops/backup/install.sh
```

Idempotent. Re-run after any deploy that changes `ops/backup/`. The first run generates the
encryption key; later runs leave it untouched.

## ⚠️ The key must live off this host

A backup encrypted with a key stored only on the machine being backed up protects against
nothing — lose the host, lose both. Copy `/etc/vps-apps/skuforge-backup.key` to wherever
`SHOPIFY_API_SECRET` is kept.

Rotating the key orphans every backup taken before the rotation. If you rotate it, keep the old
key for at least as long as you keep the old backups.

## Restore

Restore into a **scratch database first** and diff it against production before pointing the app
at it. The dump is taken with `--clean --if-exists`, so it drops objects on the way in — restoring
a bad dump straight over a live database destroys that database.

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -pass file:/etc/vps-apps/skuforge-backup.key \
  -in /var/backups/skuforge/skuforge-YYYYmmdd-HHMMSS.sql.gz.enc \
  | gunzip | docker exec -i skuforge-db-1 psql -U skuforge -d skuforge_restore_check
```

To inspect a backup without restoring it, drop the `docker exec` and redirect to a file.

## Verifying a backup

An untested backup is not a backup. Verified on 2026-08-13 against the first run: the file
decrypts, gunzips, and contains all 12 tables (`Shop`, `Session`, `GenerationJob`,
`GenerationJobItem`, `DuplicateScan`, `ScanFinding`, `SkuRuleSet`, `SequenceCounter`,
`LabelTemplate`, `JobLock`, `WebhookEvent`, `_prisma_migrations`) with their `COPY` data blocks.

Re-run that check after any Postgres major-version upgrade, since `pg_dump` and `psql` come from
the container image:

```bash
sudo /usr/local/bin/skuforge-backup.sh
```

## Design notes

- **`set -euo pipefail`** is what makes this safe. Without `pipefail`, a `pg_dump` that dies
  mid-stream still produces a valid-looking encrypted file of a truncated dump.
- **The `.partial` staging name** means a filename matching `skuforge-*.sql.gz.enc` only ever
  exists for a dump that completed. Stale partials are swept after 120 minutes.
- **The dump is logical, not physical.** It captures data and schema, not the Postgres data
  directory. Point-in-time recovery is not available; the worst case is losing up to 24 hours.
- **The Docker volume `skuforge-postgres` is not itself backed up.** These dumps are the only
  copy of production data outside the running container.
