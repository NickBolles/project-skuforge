# Testing and performance

## Automated gates

`npm run check` runs the SQLite/Postgres schema-sync check, TypeScript, ESLint (including core purity), Vitest, and the production build. Focused phase suites cover scans and cron, billing gates, compliance lifecycle, architectural invariants, and performance.

Performance budgets on the offline in-memory adapter are:

- scan a generated 10,000-variant catalog in under 5 seconds;
- plan, write, and post-verify 3,000 missing SKUs in a 10,000-variant catalog in under 30 seconds.

The tests print measured wall-clock time in their output so CI hardware regressions remain visible. These budgets test application overhead, not Shopify network throttling; a large real catalog job can take about 15 minutes and remains resumable.

Reference offline run on 2026-07-20: pure 10k scan 50.6 ms; persisted 10k scan 643.2 ms; 10k-catalog generation of 3,000 missing SKUs including mandatory verification 864 ms. Treat these as a developer-machine snapshot, not a Shopify API latency promise.

## Mock walkthrough

1. Start with `AUTH_MODE=mock MOCK_PLAN=premium npm run dev:mock`.
2. Create and mark a default SKU rule; confirm live preview values.
3. Build and apply a missing-SKU job; confirm its mandatory verification scan.
4. Fill empty internal Code 128 barcodes and confirm existing barcodes remain untouched.
5. Open labels, render each built-in template, and download a PDF.
6. Inline-edit the grid, including duplicate and barcode-overwrite confirmations.
7. Export CSV, dry-run a changed import, and apply only eligible rows.
8. Run the duplicate scan, fix a seeded group, and confirm the dashboard reaches “0 duplicate SKUs” only after verification.
9. Switch mock plans on `/app/billing`; verify free/pro/premium actions return visible upgrade reasons at the documented boundaries.
10. Set `CRON_SECRET`, invoke `npm run cron:local` twice, and confirm the second run reports `skipped_already_scanned`.
