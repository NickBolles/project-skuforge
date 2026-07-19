# SKUForge — SKU & Barcode Manager for Shopify

> **Generate, validate, and print every SKU and barcode in your store — without spreadsheets.**

**Status:** planning · **Priority:** #2 build (after AlertProof) · **Target:** $12–19/mo

## Why this exists

Verified research (July 2026):

- SKU & barcode management was the **#1 growth category** in Shopify App Store merchant searches (+182% page views, Shopify-attributed 2024 data).
- A merchant in the Shopify Community found **exactly one app that auto-fills both SKU and barcode fields — and it had no duplicate checking** ("fatal issue," their words). Recommended workarounds were spreadsheet formulas and custom scripts.
- The wedge: rule-based generation with a **hard uniqueness guarantee**, duplicate scanning/fixing, and label printing.

## Key docs

- [`PLAN.md`](./PLAN.md) — full MVP spec: features, architecture, pricing, distribution, risks.

## Kickoff Prompt

Paste this into Claude Code from the repo root to start:

```
Read PLAN.md carefully. You are helping me build SKUForge, a Shopify embedded app,
as a solo developer targeting a 4-5 week MVP.

Phase 0 — the mandatory market audit (PLAN.md flags this; do it before any code):
1. Search the Shopify App Store for current "SKU generator", "barcode generator", and
   "SKU manager" apps. For the top 5-8: pricing, ratings, and specifically whether any
   now does (a) auto-fill of BOTH SKU and barcode fields, (b) duplicate validation,
   (c) label printing. The 2022-era gap may have closed. Give me a verdict:
   build as planned / build with changed wedge / deprioritize. Wait for my go.

Phase 1 — plan (on go):
2. Check current Shopify docs: GraphQL bulk operations API (limits, async patterns for
   10k-variant catalogs), metafield/variant update mutations, and the current app scaffold.
3. Produce docs/ARCHITECTURE.md: data model (rule patterns, token grammar for
   {prefix}-{vendor}-{size}-{seq}, scan results), the duplicate-scan design (nightly cron +
   on-generation checks), and the label-PDF pipeline (Avery + thermal Dymo/Zebra sizes).
4. Produce a week-by-week GitHub issue breakdown with acceptance criteria.

Phase 2 — scaffold:
5. Scaffold the app + dev store, then build the catalog scan + duplicate report first
   (it's the demo that sells the install), and show me before continuing.

Constraints: respect API rate limits (assume 10k+ variant stores), all bulk writes
resumable/idempotent, live preview before any mutation touches real data. Be honest in
UX about internal barcodes vs GS1 UPC/EAN — never imply we generate official UPCs.
```

## Portfolio context

Second build in the 4-product plan (`alertproof` → `skuforge` → `checkoutwatch` → `ticketpilot`). Shares the Remix/billing scaffolding and Polaris patterns with AlertProof — copy, don't reinvent.
