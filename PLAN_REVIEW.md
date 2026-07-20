# SKUForge Implementation Plan — Adversarial Review

**Verdict: SOLID SKELETON, NOT YET COLLISION-SAFE — the uniqueness "hard guarantee" holds only *within* a single job, the catalog abstraction leaks Shopify's bulk-operation semantics into interactive paths, and mock auth fails open in prod. 3 BLOCKERs and 6 MAJORs fixed in-plan; ship the revised plan.**

Reviewed against `PLAN.md` (source of truth) and `README.md`. Severities: BLOCKER = wedge-breaking or ship-stopping; MAJOR = will bite during build or in first real store; MINOR = fix during implementation, left here.

---

## BLOCKERS

### B1. `assignUnique` is only collision-safe *within one job* — concurrent jobs can mint duplicates
**Problem.** The hard-uniqueness story is: build a `DupIndex` from a catalog stream at plan time, funnel proposals through `assignUnique`, write with CAS. But CAS (`expectedSku` on the *target* variant) only detects changes to the variant being written — it cannot detect that *another* variant just received the same SKU. Shopify enforces no SKU uniqueness. Two overlapping write paths — a bulk "all-missing" job + a product-create webhook job, or a CSV apply + a scan-screen one-click fix — each build their own index, each pass `assignUnique` cleanly, and both write. Sequence-block allocation only protects `{seq}` values; suffix resolution (`-2`, `-3`) and patterns without `{seq}` collide freely across jobs. The plan even tests "two concurrent jobs, no overlapping seq values" — testing the one sub-case that was already safe while the general race goes untested.
**Fix (folded into plan).** Serialize all catalog-writing jobs per shop: a `JobLock` row with `@@unique([shopId])` acquired transactionally before the run step; concurrent job requests queue (webhook) or return 409 with "a job is running" (UI). Webhook jobs additionally do a write-time point re-check via a new `findVariantsBySku()` lookup. A mandatory post-run verification scan (already `post_generation`, now an invariant, not an optimization) rescans and surfaces any duplicate that slipped through a residual race, with one-click remediation. Tests now include the adversarial cross-job case: bulk job + webhook job targeting the same namespace must yield zero duplicates.

### B2. Bulk-operation semantics leak through `streamAllVariants` — interactive paths are built on the wrong primitive
**Problem.** Shopify bulk operations are async, results (JSONL) are available **only after the operation completes**, and shops are limited to one running bulk op per type on pre-2026-01 API versions (up to 5 concurrent on 2026-01+ — still exhaustible, still not progressive). The `InMemoryShopifyCatalog` streams lazily and instantly, so the plan happily uses `streamAllVariants` for: Phase 4 live preview ("first batches only"), Phase 8 editor paging ("stream enough batches to satisfy the requested page"), and Phase 5 webhook jobs (full-catalog index for one new variant). Against the real adapter, every preview keystroke-refresh and every editor page-load launches (or collides with) a minutes-long bulk operation. The contract-test suite cannot catch this because the fake doesn't model completion-latency or exclusivity — exactly the fake-drift the suite exists to prevent.
**Fix (folded into plan).** Extend `ShopifyCatalog` with two interactive-grade methods: `listVariantsPage(opts)` (cursor-paginated standard GraphQL query with search/filter support) and `findVariantsBySku(values)` (targeted `sku:` / `barcode:` search). Bulk operations are reserved for full-catalog scans and bulk generation plan steps only. The fake now models bulk-op exclusivity (starting a second concurrent stream throws `BULK_OP_ALREADY_RUNNING`, matching real) and the contract suite asserts it; a per-shop bulk-op mutex in the service layer sequences scan vs. job-plan streams. Phase 4 preview and Phase 8 editor use `listVariantsPage`; Phase 5 webhook uses `findVariantsBySku`.

### B3. Mock auth fails open in production
**Problem.** "`AUTH_MODE=mock` (default when `SHOPIFY_API_KEY` is unset)" + "webhook HMAC check bypassed with logged warning." A production deploy with a missing/typo'd env var silently boots an unauthenticated app with a fixed dev session and unverified webhooks. This is a fail-open security default guarding real merchant catalogs.
**Fix (folded into plan).** Mock mode requires *explicit* `AUTH_MODE=mock` **and** `NODE_ENV !== "production"`. In production, missing Shopify creds is a hard boot failure with a clear error. HMAC bypass exists only inside that double-guard. A boot-time assertion test covers the misconfig matrix.

---

## MAJORS

### M1. Webhook generation path was priced at one full catalog scan per new product
**Problem.** Phase 5's plan step "seeds a DupIndex from the full catalog stream" for *every* job, including single-variant webhook jobs. On a 10k store with regular product creation, that's a bulk operation per created product — rate-limit abuse and (per B2) bulk-op contention with nightly scans.
**Fix (folded into plan).** Webhook (and scan-screen one-click-fix) jobs skip the full-stream index: render the proposal, check collisions via `findVariantsBySku` (proposed value + a small candidate window of bumped/suffixed alternatives), loop until clear within a bounded retry, write under the `JobLock`. Full-stream index only for `all_missing` / `selected` / `csv` jobs.

### M2. CAS re-fetch is not atomic — residual clobber window must be named and bounded
**Problem.** The real adapter enforces CAS by "re-fetching current values for the batch then skipping mismatches" — a read-then-write with a genuine (if small) race window that the plan presented as an absolute guarantee ("never clobbered"). Overselling the invariant is how the architecture rots when someone later widens the window.
**Fix (folded into plan).** The plan now states the honest invariant: CAS shrinks the clobber window to the re-fetch→write interval (~one batch, seconds); the never-overwrite-nonempty-barcode rule is additionally enforced by *predicate* (only write barcode when re-fetched current value is empty, independent of `expectedBarcode`), and the mandatory post-run verification scan (B1) is the backstop that converts any residual race into a surfaced finding rather than silent corruption.

### M3. Barcode-overwrite guard had a hole: CSV import and bulk editor
**Problem.** Phase 6 hard-guards auto-generation from overwriting non-empty barcode fields (merchants store real GS1 UPCs there — PLAN calls blurring this a review-killer). But Phase 9 CSV import and Phase 8 inline editing can overwrite a non-empty barcode with no special treatment — same hazard, different door.
**Fix (folded into plan).** CSV dry-run report flags every row that would replace a non-empty barcode with a *different* value as warn-level requiring an explicit "include barcode overwrites" toggle (off by default); the bulk editor shows a confirm interstitial when editing a non-empty barcode field. The guard is one shared predicate in `core/validate`, tested once, used by all three paths.

### M4. Phase 4 has a forward dependency on Phase 5's sequence service
**Problem.** Phase 4 preview "peeks `SequenceCounter` without consuming" — but `sequence.server.ts` is a Phase 5 file. As written, Phase 4 either can't build clean or grows an ad-hoc duplicate of allocation logic.
**Fix (folded into plan).** `sequence.server.ts` moves to Phase 4 with only `peekSequence(shopId, key)` (read-only); Phase 5 extends the same file with transactional block allocation. Phase ordering is now strictly backward-dependent.

### M5. Label geometry underspecified — page-count tests pass while labels print misaligned
**Problem.** The templates list label dimensions only. Avery sheets are defined by margins, gutters, and pitch (5160: 0.5" top margin, ~0.19" side margins, 0.125" column gutter, 1.0" vertical pitch); Dymo 30252 prints landscape (text runs along the 89 mm axis). Acceptance tested page counts and page size — a geometry with wrong margins passes every listed test and prints uselessly off-cell on real Avery stock, which is the retail/POS hook.
**Fix (folded into plan).** `LabelGeometry` now requires full sheet math: page size, top/left margins, label w×h, horizontal/vertical pitch, columns×rows, and per-template orientation; built-ins carry manufacturer-cited dimensions in a source comment. Tests assert the absolute x/y rect of first, last, and one middle label per template (±0.5 pt) plus start-offset placement — not just counts.

### M6. Contract suite scope was too narrow to keep the fake honest
**Problem.** Beyond exclusivity (B2), the shared contract suite didn't pin: per-product grouping of writes (real mutation is per-product), userErrors→`WriteResult` mapping shape, or that `streamAllVariants` yields nothing until "operation completion" in the real impl's lifecycle. The fake could silently drift on any of these and services would test green against fantasy semantics.
**Fix (folded into plan).** Contract suite additions enumerated in Phase 3: write grouping, error mapping, exclusivity, and a fake "completion gate" mode (no batches until the simulated bulk op completes) that services' UX must tolerate for scan/job paths.

---

## MINORS (not folded — handle during implementation)

1. **Code Set C parity.** Internal barcode values (`prefix + zero-padded counter`) must be even digit-length for pure Code C; add a settings-validation rule and an encoder test for odd-length numeric input (falls back to a B/C mix — still valid, just less dense).
2. **bwip-js oracle wiring unspecified.** Say *how* module widths are extracted: render bwip-js to SVG and parse rect x/width sequences, or use its raw/`bwipp` encoder output. Decide in Phase 6, not mid-test.
3. **Adaptive sequence blocks.** A webhook job reserving a 250-block for one variant produces absurd gaps. Allocate `min(blockSize, plannedCount)`.
4. **Data-model housekeeping.** `WebhookEvent` needs `@@index([shopId])`; `LabelTemplate` lacks the `shop` relation field and index that every sibling model has; `Shop` needs `uninstalledAt` (Phase 12 says "mark shop uninstalled" with nowhere to mark it).
5. **Cron "local midnight" is ambiguous.** Whose midnight? Use shop IANA timezone from the Shopify shop resource, else UTC; pick one and test the boundary.
6. **Scan should also flag duplicate *barcodes*.** The wedge is SKU-centric per PLAN, but a `duplicate_barcode` finding kind is nearly free with the same DupIndex machinery and merchants absolutely care.
7. **Free-plan gating vs. "the demo that sells the install."** Pricing puts duplicate scanning at $12/mo, but the scan dashboard is the install-converting demo. Consider: free = manual scan visible, *fixes* gated. Confirm against the week-0 competitor audit; don't unilaterally change the PLAN pricing matrix.
8. **CSV swap case leaves a transient duplicate mid-apply.** Two rows exchanging SKUs validate clean but pass through a duplicated state between batched writes; a crash mid-apply strands a real duplicate until the post-run scan. Order swap pairs adjacently within one batch and rely on the (now-mandatory) post-run scan; document.
9. **One-click Fix with no default rule.** Phase 10's fix uses "the default rule" — a shop can have none. Disable the button with a "set a default rule" prompt.
10. **Write-job duration expectations.** 10k variants ≈ 2k `productVariantsBulkUpdate` calls; under cost-aware throttle that's a 10–20 minute job on big stores. The job progress page exists — set copy expectations ("large stores may take ~15 minutes") so it doesn't read as a hang.
11. **Custom `LabelTemplate` UI is scope creep.** Built-in templates satisfy the MVP; keep the table (cheap) but explicitly defer any custom-template *editor* UI to post-MVP.
12. **Editor duplicate-only filter over a streamed window is incoherent** once Phase 8 moves to paged reads (B2): "duplicate-only" now sources from the latest `DuplicateScan` findings, not an on-the-fly index over a partial window. (Reflected in the Phase 8 edit; noting here for the filter-semantics test.)

---

## What the plan gets right (so it survives review intact)

- The core-purity dependency rule and pure phases P1/P2/P6/P7 are genuinely offline-verifiable; the fixture-generator + seeded-quota approach makes acceptance criteria concrete.
- In-house Code 128 with bwip-js as test oracle is the right call (small spec, no native deps, vector output for thermal).
- Never-overwrite-nonempty-barcode and the GS1-honesty copy block directly answer PLAN's review-killer warnings (now extended per M3).
- Week-0 competitor audit correctly framed as a human gate with Phases 0–3 wedge-agnostic.
- CSV pre-import validation (within-file dups + file-vs-catalog dups excluding changed rows, swap-clean semantics) is exactly the "reverse of how merchants get burned" from PLAN.
- Dual-schema Prisma portability rules (no enums, no Json) are the correct pain-avoidance for SQLite→Postgres.
