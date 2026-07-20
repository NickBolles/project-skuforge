# Nightly duplicate scan

Call `POST /api/cron/scan` once per day with `Authorization: Bearer <CRON_SECRET>`. The endpoint rejects missing or incorrect secrets, scans entitled and installed shops sequentially, and records at most one nightly attempt per shop per UTC calendar day. A repeated call returns `skipped_already_scanned` for that shop.

The deployment scheduler may be Fly cron, GitHub Actions, Supabase scheduled functions, or another HTTPS scheduler. Store `CRON_SECRET` in both the app and scheduler secret stores; never place it in source control or a query string.

For local use, start `pnpm run dev:mock` (or the equivalent npm command) and run `pnpm run cron:local` with `SHOPIFY_APP_URL` and `CRON_SECRET` set. Run it twice to verify the second response is a recorded no-op.
