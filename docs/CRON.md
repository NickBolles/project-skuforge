# Nightly duplicate scan

Call `POST /api/cron/scan` once per day with `Authorization: Bearer <CRON_SECRET>`. The endpoint rejects missing or incorrect secrets, scans entitled and installed shops sequentially, and records at most one nightly attempt per shop per UTC calendar day. A repeated call returns `skipped_already_scanned` for that shop.

Store `CRON_SECRET` in both the app and scheduler secret stores; never place it in source control or a query string.

For local use, start `npm run dev:mock` and run `npm run cron:local` with `SHOPIFY_APP_URL` and `CRON_SECRET` set. Run it twice to verify the second response is a recorded no-op.

> The nightly **database backup** is a separate cron on the same host, running at 03:37 UTC —
> twenty minutes after this one, so it captures the state the scan leaves behind. See
> `docs/BACKUPS.md`.

## Production scheduler (Hostinger VPS)

The scheduler is plain `cron` on the VPS. Everything it needs is version-controlled under
`ops/cron/`, so the VPS holds no unique copy:

| Repo file | Installed to | Purpose |
|---|---|---|
| `skuforge-cron-scan.sh` | `/usr/local/bin/skuforge-cron-scan.sh` (`0700`) | Reads the env file, POSTs to `/api/cron/scan`, logs the status code and response |
| `skuforge-scan.cron` | `/etc/cron.d/skuforge-scan` (`0644`) | Runs the script daily at **03:17 UTC** |
| `skuforge-cron.logrotate` | `/etc/logrotate.d/skuforge-cron` (`0644`) | Rotates the log monthly, keeps 12 |

Install or update, as root on the VPS:

```bash
cd /opt/vps-apps/project-skuforge && sudo bash ops/cron/install.sh
```

The install script is idempotent and refuses to run if `SHOPIFY_APP_URL` or `CRON_SECRET` is
missing from `/etc/vps-apps/skuforge.env`. Re-run it after any deploy that changes `ops/cron/`.

### Gotchas

- **`/etc/vps-apps/skuforge.env` may carry CRLF line endings.** An unstripped `\r` lands in the
  `Authorization` header and `curl` fails with exit 43. The script pipes both values through
  `tr -d '\r'`; **do not remove that**, even though the file is LF-clean today — it was rewritten
  as part of the 2026-08-13 deduplication, and nothing stops the next hand-edit from a Windows
  machine reintroducing CRs. The trailing `xargs` only trims whitespace, so a secret containing
  quotes or backslashes would be mangled — keep `CRON_SECRET` alphanumeric.
- **The env file must contain exactly one line per key.** It previously carried the example
  template header above the real values, so every key appeared twice. Both `docker compose` and
  this script take the *last* occurrence, so the placeholders were inert — but the duplicate
  `TRAEFIK_CERTRESOLVER=letsencrypt` would have broken TLS the moment anything reordered the file.
  Deduplicated 2026-08-13.
- **`/etc/cron.d/skuforge-scan` must not be group- or world-writable**, or cron silently ignores it.
- The script exits non-zero on any status other than 200, so a failure surfaces in the log and in
  cron's mail rather than passing silently.

### Verifying

```bash
tail -5 /var/log/skuforge-cron.log
```

A healthy line looks like:

```
2026-08-13T03:17:02Z http=200 {"date":"2026-08-13","results":[]}
```

An empty `results` array is expected while the only installed shop is on the Free plan —
duplicate scanning is a Pro entitlement, so there is nothing for the job to do. It starts
returning per-shop results once a shop is on a paid plan.
