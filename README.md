# SKUForge — SKU & Barcode Manager for Shopify

SKUForge generates collision-safe SKUs and internal Code 128 barcodes, scans existing catalogs for duplicate or malformed values, prints vector PDF labels, and validates CSV changes before Shopify writes.

The app is a React Router 7 Shopify app with Prisma storage. Core domain logic is isolated under `app/core`; Shopify catalog and billing integrations sit behind ports with offline fakes and recorded fixtures.

## Local development

1. Copy `.env.example` to `.env` and keep `AUTH_MODE=mock`.
2. Install dependencies and apply the SQLite migrations.
3. Run `npm run dev:mock`.
4. Use `MOCK_PLAN=free`, `pro`, or `premium` to exercise billing gates without credentials.

Mock auth is explicit and rejected in production. No live Shopify credentials are stored in this repository.

## Validation

Run `npm run check` for schema drift, typecheck, lint, tests, and the production build. See [docs/TESTING.md](./docs/TESTING.md) for focused suites and the manual walkthrough.

## Operations and architecture

- [Launch plan](./docs/LAUNCH_PLAN.md) — current status, blockers, and the path to the App Store
- [Implementation plan](./IMPLEMENTATION_PLAN.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Nightly cron](./docs/CRON.md)
- [Go-live credential handoff](./docs/GO_LIVE.md)
- [Product and market plan](./PLAN.md)
