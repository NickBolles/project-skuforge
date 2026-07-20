# Go-live credential handoff

Do not deploy until a human completes the week-0 competitor audit required by `PLAN.md`: install and assess the current top 5–8 “SKU generator”, “barcode generator”, and “SKU manager” apps, then record a build-as-planned, changed-wedge, or deprioritize verdict. This is a human market gate, not an engineering test.

## 1. Partner app and credentials

1. Create the public app in the Shopify Partner Dashboard and connect this repository with Shopify CLI.
2. Set the production application URL and allowed redirect URLs to the final HTTPS host.
3. Hand the deploy operator these values through the hosting platform’s secret store—never source control:
   - `NODE_ENV=production`
   - `AUTH_MODE=shopify`
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_APP_URL`
   - `SCOPES=read_products,write_products`
   - `DATABASE_URL` for the production PostgreSQL database
   - a randomly generated, high-entropy `CRON_SECRET`
   - `BILLING_TEST=false` (`true` only during the dev-store charge walkthrough)
   - optional `SHOP_CUSTOM_DOMAIN`
4. Confirm no `MOCK_PLAN` value is relied on in production. Production mock auth is fail-closed even if configured accidentally.

## 2. Database and deploy

1. Run the schema-sync check.
2. Generate and review the first PostgreSQL migration from `prisma/schema.postgres.prisma`; apply it to a disposable database, then production.
3. Run typecheck, lint, the full tests, and production build.
4. Run `shopify app deploy`, deploy the web service, and verify its health endpoint/startup logs.
5. Install on a development store and approve the requested product scopes. Verify an offline session exists.

## 3. Webhooks and billing

1. Verify Shopify registered `app/uninstalled`, `app/scopes_update`, `app_subscriptions/update`, `customers/data_request`, `customers/redact`, and `shop/redact` at the HTTPS routes in `shopify.app.toml`.
2. Send signed test deliveries. Confirm an invalid HMAC returns 401, uninstall stops cron and cleans sessions, and shop redaction removes application data.
3. Temporarily enable `BILLING_TEST=true` on the dev store. Approve Pro and Premium test subscriptions, verify the update webhook changes entitlements, and test cancellation back to Free. Disable test charges before production review.

## 4. Real-store smoke test

1. Create a default rule and preview it without writing.
2. Scan a controlled store and compare totals manually. Never display “0 duplicate SKUs” without a completed scan.
3. Generate a small selected batch; verify collision resolution, compare-and-set behavior, and the mandatory post-run scan.
4. Confirm automation is Pro-only, labels and CSV are Premium-only, and a 51-variant Free store receives a clear 403 upgrade reason.
5. Print one Avery and one thermal PDF at actual size; confirm geometry and barcode readability. Confirm the UI does not imply internal Code 128 values are GS1 UPC/EAN identifiers.

## 5. Nightly scheduler and listing

1. Choose Fly cron, GitHub Actions, Supabase scheduled functions, or an equivalent HTTPS scheduler.
2. Schedule one daily `POST /api/cron/scan` with `Authorization: Bearer <CRON_SECRET>`. Invoke twice and verify per-UTC-day idempotency.
3. Monitor structured logs for scan failures, billing webhook failures, and redaction events; establish alert ownership and secret rotation.
4. Prepare listing copy around “SKU generator”, “barcode generator”, and “SKU manager”; include support, privacy, data-retention, and deletion documentation.
5. Complete Partner app review evidence only after the competitor-audit verdict and real-store smoke test are signed off.
