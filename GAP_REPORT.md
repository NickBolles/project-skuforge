# SKUForge — Gap Audit Report

Audit date: 2026-07-20. Scope: implementation vs. `PLAN.md`, `IMPLEMENTATION_PLAN.md`, `PLAN_REVIEW.md`, and `docs/GO_LIVE.md`. Method: full read of `app/` (routes, services, core, adapters), Prisma schemas, `shopify.app.toml`, and the test suite; full suite executed locally (168 tests: 167 passed, 1 environment-flaky — see MINOR-6).

**Headline:** the product wedge — the hard cross-job uniqueness guarantee — is genuinely implemented and enforced at every write path. `JobLock` serialization (`app/services/job-lock.server.ts`, acquired in `runGenerationJob` for bulk/selected/webhook/fix/CSV alike), webhook/fix point re-checks via `findVariantsBySku` (`pointAssignment` in `app/services/generation.server.ts`), and the mandatory post-run verification scan (`app/services/verification.server.ts`, driving `completed_with_findings` status) are all real and covered by adversarial tests (`test/services/generation.server.test.ts`: cross-job suffix-namespace race, stale-lock reap/resume, injected residual race, 10k stress). No path was found that can mint a duplicate. The gaps below are elsewhere.

---

## (A) Implementation gaps

### BLOCKER-1 — The `products/create` webhook is never registered: auto-generation on new products is dead in production
- **Files:** `shopify.app.toml` (webhooks section), `docs/GO_LIVE.md` (§3.1), route `app/routes/webhooks.products-create.ts`
- **What's missing vs. planned:** PLAN MVP feature #1 promises "new products automatically (webhook)" — the Pro plan's headline capability. The handler route and service (`app/services/products-create.server.ts`) are fully built and tested, but only via the mock-mode trigger (`app/routes/api.dev.trigger-webhook.ts`). `shopify.app.toml` registers `app/uninstalled`, `app/scopes_update`, `app_subscriptions/update`, and the three compliance topics — **no `products/create` subscription exists anywhere**. Worse, `docs/GO_LIVE.md` §3.1's verification list also omits it, so the go-live checklist passes while the feature silently never fires on a real store. This is exactly "faked beyond the mock-adapter boundary": the feature works only through the dev trigger.
- **Fix:** add a `[[webhooks.subscriptions]]` block with `topics = ["products/create"]`, `uri = "/webhooks/products-create"` to `shopify.app.toml`; add `products/create` to the GO_LIVE §3.1 verification list and to the real-store smoke test (§4) ("create a product on the dev store, confirm a webhook job runs"). Effort: minutes; also see MAJOR-3 before shipping it.

### MAJOR-1 — Rule scope filters are honored by preview but ignored by every generation job
- **Files:** `app/services/preview.server.ts` (`variantInScope`, lines 26–33), `app/services/generation.server.ts` (`createBulkGenerationJob` target filter lines 183–186, `planSingleAssignments`), `app/services/rules.server.ts` (scope schema)
- **What's missing vs. planned:** IMPLEMENTATION_PLAN Phase 4 states scope filters (vendors/productTypes/tags) are "a shared helper, reused by generation jobs." `variantInScope` exists, is unit-tested, and is used **only** in `previewRule`. `createBulkGenerationJob` targets *every* variant missing a SKU regardless of the rule's scope; the webhook/fix path (`planSingleAssignments`) also never checks scope, so a default rule scoped to vendor X fires on any new product. Result: preview and apply disagree — the preview shows a vendor-scoped subset, "Confirm and apply" writes the whole store. That is a real merchant-facing correctness bug in a write path (uniqueness holds, but wrong variants get rule-generated SKUs).
- **Fix:** in `createBulkGenerationJob`, filter `targets` with `variantInScope(variant, config)` (config is already parsed there); in `planSingleAssignments` / `enqueueSingleVariantJob` (webhook trigger), skip out-of-scope variants and record them as `skipped`/`ignored`. Add a test: scoped rule + all_missing job → only in-scope variants receive proposals; webhook on out-of-scope product → no write.

### MAJOR-2 — Malformed-SKU detection never uses the merchant's rule; `patternToRegex` is dead code with a weaker parallel copy
- **Files:** `app/services/scan.server.ts` (`DEFAULT_SKU_PATTERN` line 9, `runScan` line 67), `app/core/sku/render.ts` (`patternToRegex`, line 113 — unused outside tests), `app/core/csv/validateImport.ts` (`skuPatternForRule`, line 32)
- **What's missing vs. planned:** Phase 2 specifies malformed detection "vs `patternToRegex` when a rule is supplied" and that CSV validation "reuses it." In practice: (a) `runScan` accepts a `skuPattern` option but **no production caller passes one** — every scan (manual, nightly, post-generation) uses the hardcoded `/^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/`, so a merchant whose SKUs legitimately contain spaces or slashes sees their whole catalog flagged "malformed" (and one-click Fix will happily rewrite them — see the scan screen), while SKUs that violate the merchant's own rule shape pass; (b) the config-aware `patternToRegex` (handles transforms, missing-token collapse, prefix) is never imported by any service; (c) `core/csv` instead grew its own simpler `skuPatternForRule` that ignores rule config (abbreviations, strip-non-alnum, missing-token policy) — two regex builders that can silently diverge.
- **Fix:** in `runScan`, load the shop's default active rule and pass `patternToRegex(parsed.ast, config)` as `skuPattern` (fall back to no malformed check, or the generic pattern clearly labeled, when no rule exists); delete `skuPatternForRule` and have `validateCsvImport` accept a prebuilt `RegExp` produced by `patternToRegex` at the service layer. Add a test that a scan's malformed findings match the default rule, not the generic constant.

### MAJOR-3 — Free-plan shops' `products/create` webhooks are answered 403, which Shopify treats as delivery failure
- **Files:** `app/services/products-create.server.ts` (lines 33–35: `EntitlementError` thrown before dedupe/ack), `app/routes/webhooks.products-create.ts` (returns `entitlementResponse` → 403)
- **What's missing vs. planned:** webhook endpoints must ack 2xx or Shopify retries (~19 times over 48h) and eventually flags/removes the subscription. Once BLOCKER-1 is fixed and the topic is registered store-wide, **every product creation on every free-plan shop** returns 403 — the entitlement check runs before the `WebhookEvent` dedupe insert and before the `autoGenerateOnCreate` settings check. Plan gating was supposed to make the feature unavailable, not fail the delivery.
- **Fix:** in `handleProductsCreate`, record the event and return `{ ignored: true, reason: "plan" }` (status 200) instead of throwing when the plan lacks `auto_generation`; keep 403 only for the interactive/dev-trigger path. Add a route test: free plan + products-create webhook → 200 with ignored status.

### MINOR-1 — Broken links to `/app/scans` (route is `/app/scan`)
- **Files:** `app/routes/app.editor.tsx` lines 79–80. Both "Run a fresh scan" / "Run a scan" links 404. (Dashboard `app._index.tsx` correctly links `/app/scan`.) Fix the hrefs.

### MINOR-2 — One-click Fix skips the planned inline preview and marks findings "fixed" regardless of outcome
- **Files:** `app/services/scan.server.ts` (`fixFinding`, lines 136–170), `app/components/FindingCard.tsx`
- Phase 10 specified "preview inline before confirm" for the fix flow; the current button plans **and immediately runs** the write job, then sets `resolution: "fixed"` unconditionally — even if the run ended `completed_with_skips` or items errored. Fix: show the proposed SKU(s) with a confirm step (the job engine already supports `previewing` status), and only mark `fixed` when all targeted items are `applied`.

### MINOR-3 — Sequence-bump collision strategy is implemented in core but never used by the job engine
- **Files:** `app/core/validate/assign.ts` (`strategy.type === "sequence"`, lines 73–103), `app/services/generation.server.ts` (all `assignUnique` call sites pass no strategy)
- Phase 2 planned "on collision, bump the sequence (re-render with next seq) … else suffix." Every production call resolves collisions straight to `-2`/`-3` suffixes, producing SKUs like `ABC-0005-2` where `ABC-0006` was intended and available. Uniqueness is unaffected; aesthetics/merchant expectations are. Wire the `sequence` strategy (with `render` closure + allocated block) into `createBulkGenerationJob`/`refreshBulkAssignments`.

### MINOR-4 — Single-process assumptions: in-memory bulk-op mutex and webhook-queue drain
- **Files:** `app/services/generation.server.ts` (`withCatalogBulkMutex` module-level `Map`, lines 96–111; `drainPendingWebhookJobs` line 599), `docs/GO_LIVE.md`
- `JobLock` is DB-backed (multi-instance safe), but the bulk-op mutex and the pending-webhook-job drain live in process memory: two app instances can start concurrent bulk operations (real API will throw `BULK_OP_ALREADY_RUNNING`, failing a scan or plan step), and webhook jobs queued as `pending` during a crash are stranded until some later job happens to run in that shop (the nightly cron does not drain them). Acceptable for a single Fly/Render instance, but nothing documents that constraint. Fix: document "run exactly one web instance" in `GO_LIVE.md`, and add a pending-job drain to the cron endpoint (cheap, reuses `drainPendingWebhookJobs`).

### MINOR-5 — Phase 12 coverage targets never wired
- **Files:** `vitest.config.ts`, `package.json` (`check` script)
- Phase 12 acceptance requires a coverage report with thresholds (core ≥ 90 % lines, services ≥ 75 %). No coverage provider, thresholds, or `--coverage` invocation exists anywhere. Add `@vitest/coverage-v8` with `coverage.thresholds` scoped per directory and include it in `npm run check`.

### MINOR-6 — Flaky test under full-suite load
- **Files:** `test/integration/core-purity.test.ts` (line 5)
- Observed in this audit: full-suite run fails `rejects a deliberate adapter import inside app/core` with a 5 s timeout (ESLint cold init took 23 s under worker contention); the same test passes in isolation in 1.7 s. Give it an explicit `{ timeout: 60_000 }` and/or share a warmed ESLint instance.

### MINOR-7 — Services materialize the full catalog in memory despite the plan's streaming intent
- **Files:** `app/services/generation.server.ts` (`catalogSnapshot`), `app/services/csv.server.ts` (`catalogSnapshot`)
- Plan §1.5 called for "streaming, no full-catalog array of results." Plan/refresh steps and CSV dry-runs collect every variant into an array. Fine at the tested 10k (sub-second), a memory risk at 50–100k-variant stores. Not urgent; worth a streaming `DupIndex` build (the index API already accepts batches) when a large real store shows up.

### MINOR-8 — Label-printing UX falls short of the selection story
- **Files:** `app/routes/app.labels.tsx` (line 13: single unfiltered `listVariantsPage({ pageSize: 50 })` — variants beyond the first 50 are unselectable, no search/paging), `app/components/VariantGrid.tsx` (lines 56–61: editor "Print labels" hardcodes `templateId=avery-5160` and product-name on, no template/copies choice)
- The core PDF pipeline itself is excellent (full sheet math, absolute-origin tests, landscape thermal, bwip-js-verified barcodes).

### MINOR-9 — Weak/self-referential assertions in two guard tests
- **Files:** `test/integration/architecture-invariants.test.ts` (string `toContain` greps on one file — would not catch a new service calling `catalog.updateVariants` directly), `app/core/labels/labels.test.ts` (absolute origins compared against `labelRect()`, the same function production uses; independent hand-computed expected coordinates exist only implicitly via the geometry constants)
- Consider an import-graph assertion (who imports `updateVariants`-capable adapters) and 2–3 hand-computed literal origin expectations per Avery template.

**Explicitly verified as NOT gaps:** fail-closed mock auth (`app/config/env.server.ts` + misconfig-matrix test); never-overwrite-nonempty-barcode enforced by predicate inside **both** adapters' `updateVariants` (`app/adapters/shopify/inMemoryCatalog.ts` line 264, `app/adapters/shopify/graphqlCatalog.ts` line 345) plus CSV default-exclusion toggle and editor interstitial; GS1-honesty copy (`INTERNAL_BARCODE_HONESTY_COPY` on `/app/generate`, CSV toggle copy, editor warning); Code128 encoder cross-checked against the bwip-js oracle (200 seeded values, exact module widths); GDPR/uninstall webhooks with real cleanup/purge (`app/services/privacy.server.ts`); server-side entitlement enforcement at scan/labels/CSV/export/cron/webhook call sites; timing-safe cron auth; real GraphQL adapter (bulk-op lifecycle, throttle, CAS re-fetch, per-product write grouping, userError mapping) tested against recorded fixtures; CSV swap-safe batching.

---

## (B) Recommended next steps

### 1. Production-webhook completion pack (effort: S, value: very high)
Register `products/create` in `shopify.app.toml`, update `docs/GO_LIVE.md` §3/§4 to verify and smoke-test it, and change `handleProductsCreate` to 200-ack below-plan/ignored deliveries (BLOCKER-1 + MAJOR-3). One small PR turns the app's headline Pro feature from "demo-only" into shippable and removes a webhook-health time bomb.

### 2. Make rules mean what they say: scope enforcement + rule-aware malformed detection (effort: M, value: high)
Apply `variantInScope` in bulk and webhook target selection, and feed `patternToRegex(defaultRule)` into `runScan` and CSV validation, deleting the duplicate `skuPatternForRule` (MAJOR-1 + MAJOR-2). This closes the two places where the preview/scan UI and the actual writes disagree — the class of inconsistency merchants notice and review-bomb — and removes dead/duplicated core code.

### 3. Fix-flow trust polish (effort: S, value: medium-high)
Inline preview + confirm on one-click Fix, `fixed` only when all items applied, repair the `/app/scans` links, and use the sequence-bump strategy before suffixing (MINOR-1/2/3). The scan screen is "the demo that sells the install" per the plan; these are the rough edges directly on that demo path.

### 4. Ops hardening for real deployment (effort: M, value: medium)
Document the single-instance constraint (or make the bulk mutex advisory via DB), drain pending webhook jobs from the cron endpoint, add coverage thresholds to `npm run check`, and de-flake the core-purity test (MINOR-4/5/6). Cheap insurance against the first production incident being a stranded webhook job or a silently shrinking test suite.

### 5. Label station usability (effort: M, value: medium)
Variant search/paging (or reuse the editor grid selection) on `/app/labels`, and a template/copies picker on the editor's Print-labels action (MINOR-8). The PDF engine is the strongest part of the codebase; the selection UI is currently the bottleneck to using it on any store with more than 50 variants — and label printing is the $19 Premium hook.
