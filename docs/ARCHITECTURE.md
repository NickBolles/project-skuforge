# Architecture

## Boundaries

Routes authenticate and translate HTTP input, services orchestrate work, adapters isolate Shopify and billing, and `app/core` contains pure domain logic. ESLint and invariant tests forbid framework, Prisma, Shopify, and adapter imports from `app/core`.

All catalog access uses `ShopifyCatalog`. Full catalog reads use the completion-gated bulk stream and a per-shop bulk mutex. Interactive pages use cursor paging or exact SKU lookups. The in-memory implementation models the production contract and supports deterministic offline tests.

## Write safety

Every catalog-writing job acquires the per-shop `JobLock`. Generated SKUs pass through `assignUnique`; single-variant webhook and scan-fix jobs also point-check candidates immediately before their compare-and-set write. Writes carry expected values, non-empty barcodes require explicit overwrite consent, and every job ends with a mandatory persisted verification scan. The dashboard hero reads the latest completed scan, so “0 duplicate SKUs” is a verified result rather than a generation counter.

## Billing and security

The billing port has fake and Shopify implementations. The entitlement matrix is pure and server routes enforce it for manual generation limits, product automation, scans and cron, labels, and CSV import/export. A rejected action returns HTTP 403 with an upgrade reason.

`AUTH_MODE=mock` works only when explicitly selected outside production. Production requires Shopify credentials at boot. Shopify authentication verifies ordinary webhook HMACs; mandatory privacy and uninstall handlers also perform an explicit constant-time HMAC check before processing.

## Data lifecycle

Customer privacy requests record only that SKUForge stores no customer data. Customer redaction is a substantive zero-record deletion. Uninstall removes sessions and locks, cancels jobs, disables rules, marks the shop uninstalled, and thereby excludes it from cron. Shop redaction deletes all shop-owned application records and sessions.
