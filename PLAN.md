# SKUForge — MVP Plan

## Spec 2: SKU & Barcode Manager for Shopify ("SKUForge")
**Rank #5 · Target $12–19/mo · Build: 4–5 weeks · Verified: +182% category search growth; named gap = auto-fill both fields with duplicate validation**

### Pitch
"Generate, validate, and print every SKU and barcode in your store — without spreadsheets." The verified complaint: exactly one app auto-filled both SKU and barcode fields, and it didn't check duplicates ("fatal issue" — merchant's words).

### Target customer
Stores past ~50 products, especially those moving into retail/POS (barcodes become mandatory), multi-channel sellers (Amazon/eBay require unique identifiers), and wholesalers. These are *operationally* motivated buyers — subscription-fatigue-resistant.

### MVP features
1. **Rule-based SKU generator:** merchant defines a pattern from tokens — {category-prefix}-{vendor}-{size}-{color}-{sequence} — with live preview against their real catalog. Apply to: all products missing SKUs, new products automatically (webhook), or selected products.
2. **Duplicate detection & validation (the named wedge):** hard guarantee of uniqueness store-wide; a scan screen listing existing duplicate/malformed SKUs with one-click fix; validation on every auto-generation. Make "0 duplicate SKUs" a proudly displayed stat.
3. **Barcode generation:** sequential internal barcodes (Code 128) auto-filled to the barcode field, with clear UX distinction between internal barcodes and official GS1 UPC/EANs (educate honestly — apps that blur this get bad reviews; if they sell on Amazon they need GS1, and saying so builds trust).
4. **Label printing:** PDF label sheets (Avery templates + common thermal sizes — Dymo/Zebra) with barcode, SKU, product name, price. This is the retail/POS hook.
5. **Bulk editor + CSV round-trip:** filterable grid of all variants/SKUs/barcodes, inline edit, export/import with validation on import (catch duplicates *before* they enter Shopify — the reverse of how merchants get burned today).

**OUT of MVP:** GS1 integration, inventory sync/multichannel push, order-level barcode scanning workflows, mobile scanning app.

### Architecture
The simplest of the four builds: Remix embedded app, bulk operations via Shopify's GraphQL bulk APIs (respect rate limits — the catalog scan must handle 10k-variant stores), pdf-lib or similar for labels, no background workers beyond a nightly duplicate-scan cron. Mostly CRUD + a rules engine + PDF generation — squarely in your lane, and the most likely to actually fit 4 weeks.

### Pricing
Free: up to 50 variants, manual generation. **$12/mo:** unlimited variants, auto-generation on new products, duplicate scanning. **$19/mo:** label printing, CSV workflows, priority support.

### Distribution
This one can lean hardest on app-store SEO — "SKU generator," "barcode generator," "SKU manager" are exactly what the +182% search-growth data says merchants type into the app store. Listing optimization is the primary channel; secondary: replies in the SKU/barcode Community threads (99196 and successors) and content ("How to set up a SKU system for your Shopify store" — evergreen, high-intent).

### Risks
The 2022-era gap may have been partially filled — **week-0 task: install and audit the top 5 current "SKU generator" apps** (2 evenings); if one now does auto-fill-both + duplicate validation well, differentiate on label printing + validation UX or deprioritize this spec. Bulk-API edge cases (variants created mid-scan) need careful idempotency.

### Brand and domain direction (2026-07-24)
**Recommendation: retain SKUForge.** It is a clear, extensible fit for SKU generation, validation, and label workflows. `skuforge.com` is registered; `getskuforge.com` appeared unregistered in a live RDAP lookup on 2026-07-24. Backup directions: SKU Stencil (`skustencil.com`) and Barcode Loom (`barcodeloom.com`) appeared unregistered in the same lookup. Confirm availability at registrar checkout and complete trademark/legal clearance before purchase or launch.

### Hosted deployment progress (2026-07-24)
The VPS release is live at immutable SHA `e08a735872d7d5e99eb0afd045ac1834b7989ddf`. Database and web containers are healthy; Traefik and public HTTPS `/healthz` are verified. Before a real merchant launch, complete the existing competitor-audit gate, then validate a Shopify development-store install, catalog scan, controlled SKU/barcode generation, signed webhooks, test billing, label printing/scanning, and nightly cron idempotency.

---

