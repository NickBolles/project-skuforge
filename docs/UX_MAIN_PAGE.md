# Main page (dashboard) — user story and UX specification

## User story

> **As a** Shopify merchant with a growing catalog (50+ products, often heading into retail/POS or multi-channel),
> **when I** open SKUForge,
> **I want** one screen that shows my catalog's SKU/barcode health and walks me to the single most valuable next action,
> **so that** I can browse, fix, generate, and export SKUs without reading docs or hunting through menus.

### Supporting stories

| # | Story | Acceptance criteria |
|---|-------|---------------------|
| 1 | As a first-time user, I want a short setup checklist so I know exactly what to do first. | Dashboard shows a numbered "Get set up" guide (create a rule → run a scan → fix findings) with the completed steps checked off and the current step linked. The guide disappears once every step is done. |
| 2 | As a returning user, I want to see catalog health at a glance. | A hero states either "0 duplicate SKUs" (success tone) or the number of open issues (critical tone), with when and how many variants were last scanned. "Scan required" is shown when no scan has completed yet. |
| 3 | As a user with problems in my catalog, I want one obvious "fix it" path. | A single recommended-next-action banner links to the highest-priority task: create rule → run first scan → fix open findings → generate missing SKUs → generate missing barcodes → all clear. Exactly one recommendation is shown at a time. |
| 4 | As a power user, I want quick actions for the common jobs. | Cards for: Browse & edit, Scan & fix, Generate SKUs, Generate barcodes, Print labels, Export CSV, Import CSV, SKU rules. Each card is one click to the task, with a one-line description. |
| 5 | As a free-plan user, I want to know what's gated before I click. | Cards for plan-gated features (scanning = Pro; labels and CSV = Premium) carry a plan badge instead of hiding the action; clicking still leads to the page, which explains the upgrade. |
| 6 | As a data-oriented user, I want the key numbers visible. | Stat tiles show total variants, missing SKUs, missing barcodes, and open duplicate groups (from the latest completed scan; em dash when unscanned). |

## Screen layout

```
┌────────────────────────────────────────────────────────────┐
│ SKUForge                                    [plan badge]   │
│                                                            │
│ ┌ Catalog health ──────────────────────────────────────┐   │
│ │  ✓ 0 duplicate SKUs            (or)  ⚠ 3 issues open │   │
│ │  Verified 1,204 variants · last scanned 2h ago       │   │
│ │  [Scan again]                                        │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌ Recommended next step (banner, tone matches urgency) ┐   │
│ │  Fix 3 open findings → Review and fix                │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌ Get set up (only until complete) ────────────────────┐   │
│ │  ✓ 1. Create a default SKU rule                      │   │
│ │  → 2. Run your first catalog scan                    │   │
│ │    3. Fix findings and fill gaps                     │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ [variants] [missing SKUs] [missing barcodes] [dup groups]  │
│                                                            │
│ Quick actions                                              │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│ │ Browse/edit │ │ Scan & fix  │ │ Generate    │  …         │
│ └─────────────┘ └─────────────┘ └─────────────┘            │
└────────────────────────────────────────────────────────────┘
```

## Behavior rules

### Health hero
- **No completed scan:** neutral tone, "Scan required", subtext explains a scan establishes the real duplicate count.
- **Scan clean** (`duplicateGroups + duplicateBarcodeGroups + malformed === 0`): success tone, headline **"0 duplicate SKUs"** — the proudly displayed stat from the product plan.
- **Scan has open issues:** critical tone, headline counts issue groups (duplicate SKU groups + duplicate barcode groups + malformed values).
- Subtext always reports `variantsScanned` and the finish time of the latest completed scan.

### Recommended next step (first match wins)
1. No active default SKU rule → "Create your SKU rule" → `/app/rules` (rules power generation and malformed-value detection).
2. No completed scan → "Run your first catalog scan" → `/app/scan`.
3. Open issue groups > 0 → "Review and fix N issues" → `/app/scan`.
4. `missingSku > 0` → "Generate SKUs for N variants" → `/app/generate`.
5. `missingBarcode > 0` → "Generate barcodes for N variants" → `/app/generate`.
6. Otherwise → success banner: catalog is healthy; nightly scans keep watch; point to browse/export.

### Setup guide
Three steps — default rule, first scan, resolve gaps (step 3 completes when rules 3–5 above are all satisfied). Shown only while at least one step is incomplete; completed steps render checked and current step carries the link.

### Quick actions
Eight cards, constant order (muscle memory beats personalization): Browse & edit SKUs (`/app/editor`), Scan & fix duplicates (`/app/scan`, Pro badge on free), Generate SKUs (`/app/generate`), Generate barcodes (`/app/generate`), Print labels (`/app/labels`, Premium badge below Premium), Export CSV (`/api/csv/export`, Premium badge), Import CSV (`/app/csv`, Premium badge), SKU rules (`/app/rules`). Gated cards stay clickable — the target page owns the upgrade conversation (existing `PlanGate` pattern).

### Stat tiles
Total variants (always live from catalog), missing SKUs / missing barcodes / duplicate groups from the latest scan summary; an em dash with "run a scan" hint when unscanned. Missing counts are informational (not "issues") — they feed the generate flows.

### Plan and shop footer
Shop domain, current plan and a link to `/app/billing`. Never blocks the page.

## Non-goals
- No charts or trends (single-scan snapshot only; nightly cron history is a later phase).
- No inline fixing on the dashboard — fixing happens on `/app/scan` where previews and confirmations live.
- No personalization/reordering of quick actions.

## Implementation notes
- Both render paths (mock-auth plain HTML and embedded Polaris web components) consume one shared view-model, `deriveDashboard()`, so the guidance logic is written and tested once.
- Loader adds: active default rule presence, plan feature flags (`duplicate_scanning`, `label_printing`, `csv_workflows`), and passes the full scan summary instead of only `duplicateGroups`.
- The embedded path uses `s-banner` (tone-mapped), `s-badge`, `s-grid`/`s-grid-item`, `s-box`, `s-stack`, and `s-button href` — all present in `@shopify/polaris-types@1.0.1`.
