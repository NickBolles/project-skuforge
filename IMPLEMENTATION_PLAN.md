# SKUForge — Phased Implementation Plan

> **Status — 2026-07-20: ✅ All phases implemented, adversarially reviewed, gap-audited, and hardened.**
> 175 tests pass, the production build passes, and the Docker image builds (`project-skuforge`, 1.01 GB; Dockerfile was fixed this session).
> `main` on GitHub is the source of truth. All BLOCKER/MAJOR gaps in [`GAP_REPORT.md`](./GAP_REPORT.md) are fixed
> (`products/create` webhook registered, preview/apply scope parity, rule-aware malformed detection). The core uniqueness wedge audited clean.
>
> **Next steps:**
> - **Deploy & live-test** → [`DEPLOYMENT_HANDOFF.md`](./DEPLOYMENT_HANDOFF.md) — VPS + Traefik + Shopify dev-store runbook. Production deployment is supplied by `docker-compose.yml` and PostgreSQL migrations under `prisma/postgres/migrations/`.
> - **Remaining backlog** → [`GAP_REPORT.md`](./GAP_REPORT.md) §B: label-station UX (variant search/paging + template picker — gates the $19 Premium hook); GS1 UPC/EAN integration; single-instance/ops docs.
> - **Human gate:** `docs/GO_LIVE.md` requires a week-0 competitor audit before public listing.

> Engineer-ready build plan derived from `PLAN.md` / `README.md`. Each phase is scoped so a single
> coding agent can execute it end-to-end and verify acceptance criteria **without any live
> credentials** (no Shopify Partner keys, no hosted Postgres). Real creds are dropped in later via
> env vars only.

---

## 1. Architecture decisions

### 1.1 Stack (pinned)

| Concern | Choice | Notes |
|---|---|---|
| App framework | **Official Shopify app template — React Router 7** (`Shopify/shopify-app-template-react-router`, `@shopify/shopify-app-react-router`) | Remix merged into React Router v7; the Remix template is deprecated in favor of this one. Scaffold with `shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router`. If CLI init requires Partner login, vendor the template by `git clone` + strip `.git` (Phase 0 covers both paths). |
| UI | **Polaris** (whatever the template ships — Polaris React or Polaris web components; keep the template's default, don't fight it) | Shared patterns with AlertProof per portfolio note. |
| ORM / DB | **Prisma**. Dev + tests: **SQLite** (template default, zero infra). Prod: **Postgres** via `DATABASE_URL` swap. | Prisma cannot switch `provider` via env var → keep two schema files (`prisma/schema.prisma` = sqlite, `prisma/schema.postgres.prisma` = identical models, postgres provider) and a sync-check script. **Model portability rules:** no Prisma `enum`s (use `String` + app-level constants), no `Json` columns (use `String` holding JSON), no pg-specific native types. |
| Shopify data access | `ShopifyCatalog` **interface** with two implementations: `GraphqlShopifyCatalog` (bulk-operation reads, throttled batched mutation writes) and `InMemoryShopifyCatalog` (fake, fixture-seeded). See §1.3. |
| Barcode | **In-house pure Code 128 encoder** (`app/core/barcode/`). The spec is small (3 code sets, checksum, start/stop). Output = abstract bar/space module widths → rendered as **vector rectangles** into pdf-lib (crisp on thermal printers, no raster deps, no canvas/native modules on Windows). Dev-dependency `bwip-js` used **only in tests** as a cross-check oracle. |
| PDF | **pdf-lib** (pure JS, no native deps). Label templates are data (geometry specs), not code. |
| CSV | **papaparse** (parse + unparse, streaming-friendly, battle-tested quoting/BOM handling). |
| Tests | **Vitest**. Unit tests for all of `app/core/*` (pure, no framework imports). Integration tests run route loaders/actions against SQLite + the in-memory catalog fake under mock auth. |
| Background work | None beyond a **nightly duplicate-scan cron** implemented as a secret-protected HTTP route + a local script runner (see Phase 10). No queues/workers. |

### 1.2 Folder layout

```
skuforge/
├─ app/
│  ├─ core/                     # PURE domain logic. Rule: no imports from shopify, react,
│  │  │                         # react-router, prisma, or app/adapters. Enforced by lint rule/test.
│  │  ├─ sku/                   # token grammar: parser, AST, renderer, transforms, seq formatting
│  │  ├─ validate/              # normalization, duplicate index, malformed detection, collision resolution
│  │  ├─ barcode/               # code128 encoder (+ tiny decoder used only by tests)
│  │  ├─ labels/                # label geometry specs (Avery/Dymo/Zebra) + pdf-lib composition
│  │  └─ csv/                   # csv schema, export shaping, import validation (pre-Shopify)
│  ├─ adapters/
│  │  ├─ shopify/               # ShopifyCatalog interface + GraphqlShopifyCatalog + InMemoryShopifyCatalog
│  │  └─ billing/               # BillingGateway interface + ShopifyBillingGateway + FakeBillingGateway
│  ├─ services/                 # orchestration: generation jobs, duplicate scans, label jobs, csv jobs.
│  │                            # Uses core + adapters + prisma. All Shopify access goes through adapters.
│  ├─ routes/                   # React Router routes (UI + API + webhooks + cron)
│  ├─ components/               # shared Polaris components (RulePreviewTable, PlanGate, etc.)
│  ├─ shopify.server.ts         # template auth wiring + mock-auth branch
│  └─ db.server.ts
├─ prisma/
│  ├─ schema.prisma             # sqlite (dev/test)
│  └─ schema.postgres.prisma    # postgres (prod) — kept in sync by scripts/check-schema-sync
├─ test/
│  ├─ fixtures/                 # fixture catalog generator + committed small fixture JSON
│  └─ integration/
├─ scripts/                     # run-cron-local, gen-fixture, check-schema-sync
└─ docs/
```

**The dependency direction is the whole architecture:** `routes → services → (core | adapters | prisma)`; `core` depends on nothing. Everything in `core/` is buildable and testable on a bare machine.

### 1.3 `ShopifyCatalog` abstraction

```ts
// app/adapters/shopify/catalog.ts
export interface CatalogVariant {
  productId: string; variantId: string;        // gid strings
  productTitle: string; variantTitle: string;
  vendor: string; productType: string; tags: string[];
  options: Record<string, string>;             // e.g. { Size: "M", Color: "Red" }
  sku: string | null; barcode: string | null;
  price: string; status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  updatedAt: string;                            // ISO — used for optimistic concurrency
}

export interface VariantWrite {
  variantId: string;
  sku?: string; barcode?: string;
  expectedSku?: string | null;                  // compare-and-set: skip if current SKU differs
  expectedBarcode?: string | null;
}

export interface WriteResult { variantId: string; status: "applied" | "skipped_conflict" | "error"; message?: string }

export interface VariantPage { variants: CatalogVariant[]; cursor: string | null; hasNext: boolean }

export interface ShopifyCatalog {
  /**
   * Full catalog stream. Real impl = GraphQL bulk operation (JSONL download), paged into batches.
   * BULK-OP SEMANTICS (part of the contract, modeled by the fake): async — yields NOTHING until the
   * operation completes (minutes on large stores); per-shop concurrency is limited (1 per type on
   * pre-2026-01 API versions, 5 on 2026-01+). Starting a stream while one is active throws
   * BULK_OP_ALREADY_RUNNING. Reserved for full scans and bulk-job plan steps ONLY — never for
   * interactive request/response paths (preview, editor paging, webhooks). Those use the two
   * methods below.
   */
  streamAllVariants(opts?: { batchSize?: number }): AsyncIterable<CatalogVariant[]>;
  /** Interactive cursor-paginated read (standard GraphQL products/variants query + search filters).
   *  Used by rule preview (Phase 4) and the bulk editor (Phase 8). */
  listVariantsPage(opts: { cursor?: string; pageSize: number;
    filter?: { text?: string; vendor?: string; productType?: string;
               missingSku?: boolean; missingBarcode?: boolean } }): Promise<VariantPage>;
  /** Targeted existence lookup by exact SKU/barcode values (query: "sku:X OR sku:Y").
   *  Used by webhook/single-variant generation and scan-screen fixes for collision checks
   *  without a full-catalog stream. */
  findVariantsBySku(values: string[], field?: "sku" | "barcode"): Promise<CatalogVariant[]>;
  getVariants(variantIds: string[]): Promise<CatalogVariant[]>;
  countVariants(): Promise<number>;
  /** Batched, throttled, compare-and-set writes. Never throws on per-variant conflict — reports it. */
  updateVariants(writes: VariantWrite[]): Promise<WriteResult[]>;
}
```

- **Reads:** real impl uses a GraphQL **bulk operation** query (async, poll `currentBulkOperation`, download JSONL) — the only pattern that survives 10k-variant stores. Fake impl streams from an in-memory array in batches **and models the real semantics**: a "completion gate" (no batches until the simulated op completes) and per-shop exclusivity (`BULK_OP_ALREADY_RUNNING` on concurrent streams) — both asserted by the contract suite so services can never accidentally build an interactive feature on the bulk primitive. A service-layer per-shop **bulk-op mutex** sequences full-stream consumers (nightly scan vs. job plan step).
- **Interactive reads:** `listVariantsPage` (cursor pagination, search filters) and `findVariantsBySku` (exact-value lookup) back every request/response path. Real impl = standard GraphQL queries under the normal cost throttle; fake = filtered in-memory paging. These are cheap, progressive, and safe to call per keystroke/page.
- **Writes:** real impl uses `productVariantsBulkUpdate` (variants grouped **per product** — that mutation takes one productId), batched with a cost-aware throttle (respect `extensions.cost.throttleStatus`, retry on `THROTTLED` with backoff). Fake impl applies in memory and can be configured with `simulate: { throttleEveryN, conflictVariantIds, errorVariantIds }` to exercise retry/conflict paths in tests.
- **Mid-scan mutation safety (idempotency) — honest invariant:** every write carries `expectedSku`/`expectedBarcode` captured at read time; the real impl re-fetches current values per batch (one `nodes(ids:)` query) and skips mismatches. This is read-then-write, **not atomic** — it shrinks the clobber window to the re-fetch→write interval (seconds per batch), it does not eliminate it. Three additional guards make the system safe end-to-end: (1) the never-overwrite-nonempty-**barcode** rule is enforced by *predicate* on the re-fetched value (write barcode only when currently empty), independent of `expectedBarcode`; (2) all catalog-writing jobs are serialized per shop via `JobLock` (§2 / Phase 5) so app-originated writes can never race each other; (3) a **mandatory post-run verification scan** after every write job converts any residual race (e.g. a merchant manual edit in the window) into a surfaced finding with one-click fix — never silent corruption. Generation jobs persist per-variant status so re-running a job is a no-op for applied items.
- **Cross-job uniqueness:** `assignUnique` guarantees uniqueness against the index it was given — which is only as fresh as the plan step. The store-wide guarantee therefore requires that at most one catalog-writing job runs per shop at a time (`JobLock`), plus write-time point re-checks (`findVariantsBySku`) on the webhook/single-variant path. Both are hard requirements, not optimizations.
- **Fixture catalog:** `test/fixtures/gen-catalog.ts` deterministically (seeded PRNG) generates catalogs of any size with realistic vendors/types/options, a configurable % of missing SKUs, deliberate duplicate clusters, and malformed SKUs. A small (~120 variant) fixture is committed as JSON; the **10k-variant stress fixture** is generated on demand (`npm run gen:fixture -- --variants 10000`) and used by scan/generation perf tests.

### 1.4 Auth & app-boot without Shopify creds

`shopify.server.ts` branches on `AUTH_MODE`:

- `AUTH_MODE=shopify` (default): template behavior — embedded OAuth/session-token auth, real API key/secret required.
- `AUTH_MODE=mock` (**explicit opt-in only, never a fallback**): a `mockAuthenticate()` returns a fixed dev session (`shop = "dev-shop.myshopify.test"`), `getCatalog(session)` returns the `InMemoryShopifyCatalog` seeded from the committed fixture, `BillingGateway` returns the fake (plan selectable via `MOCK_PLAN` env: `free|pro|premium`). App Bridge is not initialized in mock mode (plain browser page). **Every UI phase's acceptance criteria run in this mode.**

**Fail-closed rule (security):** mock mode engages only when `AUTH_MODE=mock` is explicitly set **and** `NODE_ENV !== "production"`. In production, missing/blank `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` is a **hard boot failure** with a clear error — the app must never silently fall back to an unauthenticated dev session or skip webhook HMAC verification because an env var went missing. The HMAC bypass exists only inside this double guard. A boot-time assertion (unit-tested across the misconfig matrix: prod+no-creds → throw; prod+`AUTH_MODE=mock` → throw; dev+unset → helpful error telling you to set `AUTH_MODE=mock`) lives in `shopify.server.ts`. `npm run dev:mock` sets `AUTH_MODE=mock` itself so local DX is unchanged.

The factory lives in one place — `app/services/context.server.ts` exports `getAppContext(request)` → `{ session, catalog, billing, db }` — so routes never construct adapters directly.

### 1.5 Testing approach

| Layer | How | Creds needed |
|---|---|---|
| `core/*` | Vitest unit + property-style tests (fast-check optional; hand-rolled generators fine). Barcode encoder cross-checked against `bwip-js` (devDep) and a tiny in-repo Code 128 decoder. PDF tests re-open output with pdf-lib and assert page count/size + extract embedded text ops. | none |
| services | Vitest against SQLite (fresh file per suite) + `InMemoryShopifyCatalog`. Conflict/throttle paths driven by fake's `simulate` knobs. 10k-variant scan/generation perf test (assert wall-clock ceiling + memory sanity — streaming, no full-catalog array of results). | none |
| routes | Integration: call loaders/actions directly with mock-auth request, assert JSON/redirects; a handful of smoke tests boot the dev server in `AUTH_MODE=mock` and fetch key pages. | none |
| real Shopify adapter | Unit-tested against **recorded/handwritten GraphQL response fixtures** (bulk-op lifecycle JSONL, throttle responses). Live verification is a post-creds manual checklist in `docs/GO_LIVE.md`. | later |

CI = `npm run check` → typecheck + lint (incl. core-purity import lint) + vitest + schema-sync check.

---

## 2. Data model (Prisma)

All `String` fields noted as `(json)` hold serialized JSON (SQLite portability). No enums — allowed values in `app/core/constants.ts`.

```prisma
model Session { /* exactly as shipped by the Shopify template — do not modify */ }

model Shop {
  id            String   @id @default(cuid())
  shopDomain    String   @unique
  plan          String   @default("free")        // free | pro | premium
  planUpdatedAt DateTime?
  settings      String   @default("{}")          // (json) { autoGenerateOnCreate, barcodePrefix, abbreviations: {...} }
  createdAt     DateTime @default(now())
  ruleSets        SkuRuleSet[]
  generationJobs  GenerationJob[]
  scans           DuplicateScan[]
  counters        SequenceCounter[]
  webhookEvents   WebhookEvent[]
}

model SkuRuleSet {
  id          String   @id @default(cuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  name        String
  pattern     String                             // raw pattern, e.g. "{category:3}-{vendor:3}-{option:Size}-{seq:4}"
  config      String   @default("{}")            // (json) { separator, casing: "upper"|"lower"|"asis",
                                                 //          stripNonAlnum, abbreviations: {token: {value: abbr}},
                                                 //          scope filters: { vendors?, productTypes?, tags? } }
  isDefault   Boolean  @default(false)           // used by the product-create webhook
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([shopId])
}

model SequenceCounter {
  id        String @id @default(cuid())
  shopId    String
  shop      Shop   @relation(fields: [shopId], references: [id])
  key       String                               // "rule:<ruleSetId>" | "barcode" | "rule:<id>:prefix:<rendered-prefix>"
  nextValue Int    @default(1)
  @@unique([shopId, key])
}
// Allocation: single UPDATE ... in a transaction, reserving a BLOCK (e.g. 250) for bulk jobs.
// Gaps from failed jobs are acceptable and documented.

model JobLock {
  // At most ONE catalog-writing job (generation / csv-apply / scan-fix) runs per shop at a time.
  // This is a load-bearing part of the uniqueness guarantee: assignUnique is only collision-safe
  // against the index it was given, so app-originated writes must never race each other.
  // Acquire = transactional create (unique violation → lock held); release on finish/fail/cancel;
  // stale locks (heartbeat older than N min) are reap-able by the next acquirer.
  shopId      String   @id
  jobId       String                             // holder
  kind        String                             // "generation" | "csv" | "fix"
  acquiredAt  DateTime @default(now())
  heartbeatAt DateTime @default(now())           // updated per batch; staleness = crash detection
}

model GenerationJob {
  id             String    @id @default(cuid())
  shopId         String
  shop           Shop      @relation(fields: [shopId], references: [id])
  ruleSetId      String
  trigger        String                          // "all_missing" | "selected" | "webhook" | "csv" | "fix"
  fields         String                          // (json) ["sku"] | ["sku","barcode"] | ["barcode"]
  status         String    @default("pending")   // pending | previewing | running | completed | completed_with_skips | failed | cancelled
  idempotencyKey String    @unique               // webhook: "wh:<webhookId>"; UI: client-generated uuid
  totals         String    @default("{}")        // (json) { planned, applied, skippedConflict, errored }
  cursor         String?                         // resume point (batch index) for crash recovery
  error          String?
  createdAt      DateTime  @default(now())
  finishedAt     DateTime?
  items          GenerationJobItem[]
  @@index([shopId, status])
}

model GenerationJobItem {
  id          String  @id @default(cuid())
  jobId       String
  job         GenerationJob @relation(fields: [jobId], references: [id])
  variantId   String
  productId   String
  proposedSku     String?
  proposedBarcode String?
  expectedSku     String?                        // value at preview time (compare-and-set basis)
  status      String  @default("planned")        // planned | applied | skipped_conflict | error
  message     String?
  @@unique([jobId, variantId])                   // idempotent re-runs
  @@index([jobId, status])
}

model DuplicateScan {
  id          String    @id @default(cuid())
  shopId      String
  shop        Shop      @relation(fields: [shopId], references: [id])
  trigger     String                             // "manual" | "nightly" | "post_generation"
  status      String    @default("running")      // running | completed | failed
  totals      String    @default("{}")           // (json) { variantsScanned, duplicateGroups, duplicateVariants, malformed, missingSku, missingBarcode }
  startedAt   DateTime  @default(now())
  finishedAt  DateTime?
  findings    ScanFinding[]
  @@index([shopId, startedAt])
}

model ScanFinding {
  id         String  @id @default(cuid())
  scanId     String
  scan       DuplicateScan @relation(fields: [scanId], references: [id])
  kind       String                              // "duplicate" | "malformed" | "missing_sku" | "missing_barcode"
  skuValue   String?                             // normalized value for duplicate groups
  variants   String                              // (json) [{variantId, productId, title, sku, barcode}]
  resolution String  @default("open")            // open | fixed | ignored
  resolvedAt DateTime?
  @@index([scanId, kind, resolution])
}

model LabelTemplate {                             // BUILT-IN templates live in code (core/labels/templates.ts).
  id        String @id @default(cuid())          // This table stores per-shop custom/tweaked templates only.
  shopId    String
  name      String
  kind      String                               // "sheet" (Avery-style grid) | "thermal" (one label/page)
  geometry  String                               // (json) LabelGeometry — same shape as built-ins
  content   String @default("{}")                // (json) { showTitle, showPrice, showSku, barcodeHeightMm, fontPt }
  createdAt DateTime @default(now())
}

model WebhookEvent {
  id         String   @id                        // Shopify webhook id header — natural dedupe key
  shopId     String
  shop       Shop     @relation(fields: [shopId], references: [id])
  topic      String
  payload    String                              // (json)
  status     String   @default("received")       // received | processed | skipped | error
  createdAt  DateTime @default(now())
}
```

---

## 3. Env vars & external creds

**Blocking (nothing can be built without it): none.** Every external dependency is mockable.

| Var | Needed in prod | Local strategy |
|---|---|---|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | yes (OAuth, session tokens, webhook HMAC; **missing in prod = hard boot failure, never a mock fallback**) | set `AUTH_MODE=mock` explicitly (non-prod only): fixed dev session, `InMemoryShopifyCatalog`, webhook HMAC check bypassed with logged warning |
| `SHOPIFY_APP_URL`, `SCOPES` (`read_products,write_products`) | yes | defaults: `http://localhost:3000`, scopes string constant |
| `DATABASE_URL` | yes (Postgres) | SQLite `file:./dev.sqlite` via `schema.prisma`; prod uses `schema.postgres.prisma` |
| `CRON_SECRET` | yes (protects `/api/cron/*`) | any string in `.env`; local runner script passes it |
| `MOCK_PLAN` | no | dev-only: `free|pro|premium` for the FakeBillingGateway |
| `AUTH_MODE` | no (defaults to `shopify`) | must be explicitly set to `mock` locally (`dev:mock` script does this); rejected outright when `NODE_ENV=production` |

Billing (Shopify Billing API) and webhooks need real creds + a dev store — both sit behind interfaces (`BillingGateway`, webhook route calls the same service the mock trigger endpoint calls). `docs/GO_LIVE.md` (Phase 12) is the checklist for wiring real creds: create Partner app, set env vars, run `shopify app deploy`, register webhooks, run manual verification passes on a dev store.

---

## 4. Phases

Conventions for every phase: work only in the listed files (+ tests); `npm run check` must pass at the end; acceptance criteria must be demonstrable with **no network access to Shopify and no Postgres**.

---

### Phase 0 — Scaffold, config, DB, mock-auth spine
**Goal:** Running app skeleton in mock mode with CI-style checks, Prisma schema migrated, fixture generator, and the core-purity lint in place.

**Files:** entire template scaffold; `prisma/schema.prisma` + `schema.postgres.prisma` (all §2 models); `app/services/context.server.ts`; `app/adapters/shopify/catalog.ts` (interface + types only); `app/adapters/billing/gateway.ts` (interface + `FakeBillingGateway`); `test/fixtures/gen-catalog.ts` + committed `catalog-small.json` (~120 variants incl. seeded duplicates/malformed/missing); `scripts/check-schema-sync.mjs`; `scripts/gen-fixture.mjs`; ESLint rule (or vitest import-graph test) forbidding non-core imports inside `app/core`; `.env.example` documenting every var in §3; `vitest.config.ts`; npm scripts: `dev:mock`, `check`, `gen:fixture`.

**Key notes:** Try `shopify app init --template=...react-router`; if the CLI insists on Partner login, `git clone` the template and strip git metadata — record which path was taken in `docs/DECISIONS.md`. Do not modify the template's `Session` model. Home route (`/app`) renders a Polaris page showing shop domain, plan, and variant count from the catalog fake — proves the whole spine.

**External deps/env:** none live. `AUTH_MODE=mock` default.

**Tests:** fixture generator determinism (same seed → same catalog; sizes 120 and 10k; duplicate/malformed quotas present); context factory returns fake adapters when unset; schema-sync check passes; core-purity lint fires on a deliberate bad import (test the test).

**Acceptance:** `npm run dev:mock` serves `/app` showing fixture-derived variant count with zero creds; `npm run check` green; `npm run gen:fixture -- --variants 10000` completes < 10s.

---

### Phase 1 — SKU pattern/token engine (pure)
**Goal:** Complete, exhaustively tested token grammar → parser → renderer in `app/core/sku/`.

**Files:** `app/core/sku/{grammar.ts, parse.ts, render.ts, transforms.ts, types.ts}` + tests.

**Key notes:** Tokens: `{prefix}` (literal from config), `{vendor}`, `{product-type}`/`{category}`, `{title}`, `{option:<Name>}` (e.g. `{option:Size}`), `{seq}`; all support `:N` truncation (`{vendor:3}`) and the seq supports padding (`{seq:4}` → `0001`). Literal separators between tokens are free text. Transforms (config-driven, applied in fixed order): abbreviation map lookup (per-shop dictionary, e.g. `"Extra Large" → "XL"`), strip non-alphanumerics, casing. Parser returns AST or **structured errors with position** (the rule-builder UI will surface these). Renderer signature is pure: `render(ast, context: {variant fields…}, seq: number, config) → string`. Missing context values (variant lacks the option) → deterministic policy from config: `skip-token | placeholder | error` (default skip-token, collapse doubled separators). Also export `patternToRegex(ast, config)` — the malformed-SKU detector in Phase 2 and CSV validation reuse it. **No DB, no sequence allocation here** — seq comes in as a number.

**Tests:** table-driven cases for every token/transform/edge (unicode titles, empty vendor, missing option, truncation shorter than abbreviation, double separators); parse-error positions; `patternToRegex` matches everything `render` emits for randomized contexts (1k seeded iterations); snapshot of the token-reference doc examples.

**Acceptance:** `vitest run app/core/sku` green; a demo script (`npx tsx scripts/demo-sku.ts`) prints rendered SKUs for the small fixture's first 20 variants against 3 sample patterns.

---

### Phase 2 — Uniqueness/duplicate validator (pure)
**Goal:** The wedge, as a pure library: duplicate index, malformed detection, collision-safe assignment.

**Files:** `app/core/validate/{normalize.ts, dupIndex.ts, scan.ts, assign.ts, types.ts}` + tests.

**Key notes:** `normalizeSku` (trim, uppercase, configurable) — duplicates are judged on normalized values but originals are preserved for display. `DupIndex`: built incrementally from a stream of `{variantId, sku}` (works with `AsyncIterable` batches — never assumes whole catalog in one array); O(1) `has/add/groups()`. `scanCatalog(stream, opts)` → findings: duplicate groups, malformed (vs `patternToRegex` when a rule is supplied), missing SKU, missing barcode. `assignUnique(proposedSku, index, strategy)`: on collision, bump the sequence (re-render with next seq) up to a bounded retry, else suffix `-2`, `-3`; returns `{sku, collisionsResolved}`. This function is the **hard uniqueness guarantee** — every generation path in later phases must funnel through it, and it also checks proposed-vs-proposed collisions within a single job batch.

**Tests:** duplicate grouping incl. case/whitespace variants; malformed detection against Phase-1 patterns; `assignUnique` under adversarial collision chains; property test: generating N SKUs through `assignUnique` against any starting index yields zero duplicates (seeded, N=5k); streaming scan over the 10k fixture completes < 2s and finds exactly the fixture's seeded duplicate/malformed quotas.

**Acceptance:** `vitest run app/core/validate` green including 10k stress; demo script prints a scan summary ("X duplicate groups, Y malformed…") for the small fixture.

---

### Phase 3 — ShopifyCatalog adapters: in-memory fake + real GraphQL impl
**Goal:** Both implementations of §1.3, with the real one tested purely against recorded fixtures.

**Files:** `app/adapters/shopify/{catalog.ts (finalize), inMemoryCatalog.ts, graphqlCatalog.ts, bulkOperation.ts, throttle.ts}`; `test/fixtures/graphql/` (bulk-op lifecycle responses, JSONL sample, throttle/backoff responses, `productVariantsBulkUpdate` success/userErrors payloads); tests.

**Key notes:** Fake: seeds from fixture JSON or generator; `simulate` knobs `{ throttleEveryN, conflictVariantIds, errorVariantIds, mutateDuringStream, bulkOpDelay }` — `mutateDuringStream` injects variant creation/edits mid-stream to rehearse the mid-scan idempotency story; the fake also enforces **bulk-op exclusivity** (second concurrent `streamAllVariants` → `BULK_OP_ALREADY_RUNNING`) and a **completion gate** (`bulkOpDelay`: no batches yielded until the simulated op "completes") so services cannot be built assuming progressive/instant bulk reads. Real: `streamAllVariants` runs `bulkOperationRunQuery` → poll → download JSONL (parse line-by-line, reassemble parent/child rows into `CatalogVariant`, stream in batches — never hold 10k in memory); `listVariantsPage` = standard paginated `productVariants` query with search-syntax filters; `findVariantsBySku` = exact-value `query: "sku:A OR sku:B"` lookup; `updateVariants` groups writes per product for `productVariantsBulkUpdate`, spends a cost budget from `throttleStatus`, exponential backoff on `THROTTLED`, maps `userErrors` per variant; compare-and-set enforced by re-fetching current values for the batch (one `nodes(ids:)` query) and skipping mismatches (see §1.3 for the honest non-atomicity statement). Both impls must pass **one shared contract-test suite** (`describe.each([fake, mockedReal])`) so the fake can't drift from the real semantics. The contract suite must pin, at minimum: stream completeness + batching; **no data before bulk-op completion**; **exclusivity error on concurrent streams**; `listVariantsPage` cursor stability + filter semantics; `findVariantsBySku` exact-match (incl. normalization edge: search is case-insensitive — document and mirror); per-**product** grouping of `updateVariants` calls; `userErrors` → `WriteResult` mapping shape; CAS skip reporting; count.

**External deps/env:** real impl's HTTP layer injected (`fetch`-compatible) → tests stub it with fixture responses. No live calls.

**Tests:** shared contract suite (see key notes list — incl. exclusivity, completion gate, paging, point lookup, per-product write grouping); real-impl bulk lifecycle incl. `FAILED`/timeout paths; throttle/backoff behavior (fake timers); JSONL reassembly with interleaved parent/child lines; fake's `mutateDuringStream` proves CAS skips.

**Acceptance:** contract suite green against both; 10k-variant fake stream + full scan (Phase 2) under 5s; no adapter import leaks into `core` (lint).

---

### Phase 4 — Rule management UI + live preview
**Goal:** CRUD for `SkuRuleSet` with a Polaris rule builder and live preview against the (fake) catalog.

**Files:** `app/routes/app.rules.tsx`, `app.rules.$id.tsx`; `app/components/{RuleBuilder.tsx, TokenPicker.tsx, RulePreviewTable.tsx}`; `app/services/rules.server.ts`, `app/services/preview.server.ts`; `app/services/sequence.server.ts` (**read-only `peekSequence(shopId, key)` only** — Phase 5 extends this same file with transactional block allocation; introducing the peek here removes the forward dependency); tests.

**Key notes:** Builder = pattern text input + token palette + config controls (separator, casing, abbreviations editor, seq padding, scope filters, missing-token policy). Parse errors from Phase 1 shown inline with position. **Live preview:** action samples ~25 in-scope variants via `catalog.listVariantsPage` (**never `streamAllVariants`** — bulk ops are async, completion-gated, and per-shop limited; interactive paths must use paged reads, and the fake's completion gate/exclusivity will fail any test that gets this wrong), renders proposed SKUs with a *simulated* sequence (`peekSequence` — read-only, nothing consumed), and runs them through the Phase-2 index built from a catalog SKU sample (paged) + the proposals themselves, badging would-be collisions. Collision badges are labeled "sample-based" — the authoritative check is the job plan step. Preview must be visibly labeled "preview — nothing written". `isDefault` toggle (one per shop) for the future webhook path. Scope filters evaluated in `preview.server.ts` (vendor/productType/tags match) — shared helper, reused by generation jobs.

**External deps/env:** mock mode only.

**Tests:** service-level CRUD + validation (reject unparseable pattern, duplicate default); preview service returns correct proposals/collision badges for crafted fixtures; loader/action integration tests with mock auth.

**Acceptance:** in `dev:mock`, create/edit a rule, see live preview over fixture variants incl. at least one collision badge; invalid pattern shows positioned error; `npm run check` green.

---

### Phase 5 — Apply-generation flows (all-missing / selected / webhook) with idempotency
**Goal:** The write path: `GenerationJob` engine funneling every proposal through `assignUnique`, with block sequence allocation, CAS writes, resumability, and the product-create webhook.

**Files:** `app/services/generation.server.ts`, `app/services/sequence.server.ts`; `app/routes/{app.generate.tsx, app.generate.$jobId.tsx, api.jobs.$jobId.ts (poll), webhooks.products-create.ts, api.dev.trigger-webhook.ts (mock-mode only)}`; tests.

**Key notes:**

- **Per-shop job serialization (load-bearing for the uniqueness guarantee):** before the run step, acquire the shop's `JobLock` (transactional create; unique violation = lock held). At most one catalog-writing job (generation / csv / fix) runs per shop at any time — `assignUnique` is only collision-safe against the index it was given, so two concurrent jobs (e.g. bulk "all-missing" + a webhook job, each individually clean) could otherwise mint the same SKU on different variants and CAS would not catch it (CAS guards the *target* variant, not the namespace). UI-triggered second job → 409 "a job is running" with a link to it; webhook jobs enter a `pending` queue drained when the lock frees (simple poll on lock release — no worker infra). Lock heartbeats per batch; stale lock (heartbeat > N min old) is reaped by the next acquirer (covers crashed jobs alongside `cursor` resume). Release on completed/failed/cancelled.
- **Bulk flow** (`all_missing` / `selected` / `csv`): create job (`idempotencyKey` unique — re-POST returns existing job) → **plan step**: stream in-scope variants (`streamAllVariants` under the service-layer bulk-op mutex — this is a legitimate bulk-primitive consumer), filter to targets, build `GenerationJobItem`s with `expectedSku` captured, allocate sequences in blocks of `min(blockSize, plannedCount)` (§2), run all proposals through a `DupIndex` seeded from the full catalog stream **plus the job's own proposals** → **preview screen** (counts + first 50 rows) → explicit confirm → **run step** (lock held): batched `catalog.updateVariants` with CAS, item statuses updated per `WriteResult`, `cursor` advanced per batch (crash-resume = skip items already `applied`). Cancel between batches supported.
- **Single-variant flow** (`webhook` / `fix`): **no full catalog stream** — a bulk operation per product-create webhook would hammer rate limits and collide with the per-shop bulk-op limit. Instead: render the proposal, check collisions via `catalog.findVariantsBySku([proposed, ...bumpedCandidates])`, loop `assignUnique` against those point lookups until clear (bounded retries), then write under the same `JobLock`.
- **Mandatory post-run verification scan (invariant, not an optimization):** every write job, on release of the lock, triggers a `post_generation` scan (Phase 10 machinery; until Phase 10 lands, a thin service stub that runs Phase-2 `scanCatalog` and asserts/records the duplicate count). Any duplicate that slipped through a residual race (merchant manual edit inside the CAS window) becomes a surfaced finding — never silent. Job status reflects it: `completed` requires verification-clean; otherwise `completed_with_findings`.
- **Webhook route:** verify HMAC (bypassed+logged in mock — see §1.4 fail-closed rule), insert `WebhookEvent` (PK dedupe → replay = no-op), if shop settings `autoGenerateOnCreate` and a default rule exists, enqueue a single-variant job with `idempotencyKey = "wh:<webhookId>"`. Plan gating hooks exist but everything is allowed until Phase 11 (`billing.can(shop, "auto_generation")` — Fake returns true).

**External deps/env:** none live; webhook exercised via `api.dev.trigger-webhook` posting a synthetic payload (mock mode only, 404 in prod).

**Tests:** job on 10k fixture with 30% missing SKUs → zero duplicates post-run (assert via full rescan), correct totals; idempotency (same key → same job; re-run applies nothing twice); CAS conflicts via fake's `mutateDuringStream`/`conflictVariantIds` → `skipped_conflict`, job `completed_with_skips`; resume after simulated crash mid-batch (incl. stale-lock reap); webhook dedupe on replay; sequence block allocation under concurrent jobs (two jobs, no overlapping seq values); **cross-job uniqueness race**: bulk job + webhook job fired concurrently into the same SKU namespace (incl. a pattern *without* `{seq}` and a suffix-resolution case) → lock serializes them and post-state has zero duplicates; second UI job while lock held → 409; webhook job queued during a bulk run executes after release exactly once; verification scan fires after every job and flags an artificially injected race duplicate.

**Acceptance:** in `dev:mock`: run "apply to all missing" over the fixture, watch job progress page reach completed, rescan shows 0 missing/0 duplicates; trigger the dev webhook twice → one job, one variant filled. All tests green with 10k stress under 30s.

---

### Phase 6 — Code 128 barcode generation (pure) + assignment flow
**Goal:** In-house Code 128 encoder and the "fill barcode field" path, sharing the Phase-5 job engine.

**Files:** `app/core/barcode/{code128.ts, encode.ts (value→module widths), decode.ts (test-only helper), svg.ts (dev preview)}`; extend `generation.server.ts` for `fields:["barcode"]`; barcode settings in Shop settings (prefix, start number, digits); tests.

**Key notes:** Encoder: code sets A/B/C with standard minimal-length optimization (digit runs → C), checksum char, start/stop, quiet zones; output `{ modules: number[] }` (alternating bar/space widths in module units) + total width — rendering is a separate concern (SVG for UI preview, vector rects for PDF in Phase 7). Internal barcode values: numeric `prefix + zero-padded counter` from `SequenceCounter key="barcode"` — pure Code Set C, dense. **UX honesty (from PLAN):** settings + generation screens carry the fixed copy block: internal Code 128 barcodes are for in-store/POS use and are *not* GS1 UPC/EANs; Amazon/retail distribution requires GS1. Never auto-overwrite a non-empty barcode field (merchants store real UPCs there) — non-empty targets are excluded by default with an explicit, separately-confirmed override. Uniqueness of barcode values enforced with the same `DupIndex` machinery keyed on barcode.

**Tests:** known-vector encodings (spec examples + edge strings), checksum correctness, code-set optimization cases; round-trip via in-repo decoder for 1k random strings; cross-check module widths against `bwip-js` (devDep) for 200 seeded values; generation flow: fills only empty barcode fields, dedupes, respects the overwrite guard.

**Acceptance:** `vitest run app/core/barcode` green incl. bwip-js cross-check; in `dev:mock` the barcode settings page shows a live SVG preview of the next barcode; "generate barcodes for variants missing them" job completes over fixture with 0 duplicates and untouched non-empty fields.

---

### Phase 7 — PDF label printing (Avery sheets + thermal)
**Goal:** pdf-lib label pipeline: built-in geometries, composition, download route with print options.

**Files:** `app/core/labels/{templates.ts, geometry.ts, compose.ts, barcodeDraw.ts}`; `app/services/labels.server.ts`; `app/routes/{app.labels.tsx, api.labels.pdf.ts}`; `app/components/LabelPreview.tsx`; tests.

**Key notes:** Built-in `LabelGeometry` specs must be **full sheet math, not just label dimensions** — a geometry with only w×h passes page-count tests and still prints off-cell on real stock. Required fields per template: page size, top/left margins, label width×height, horizontal/vertical **pitch** (center-to-center — encodes gutters), columns×rows, and orientation; every built-in carries a source comment citing the manufacturer spec sheet. Built-ins (all dims in mm, converted to pt at render): **Avery 5160** (US Letter, 30/sheet 3×10, label 66.675×25.4, top margin 12.7, left margin ~4.76, h-pitch ~69.85, v-pitch 25.4), **5163** (10/sheet 2×5, 101.6×50.8, top margin 12.7, left margin ~4.06, v-pitch 50.8), **5167** (80/sheet 4×20, 44.45×12.7, top margin 12.7, left margin ~7.3, h-pitch ~51.6, v-pitch 12.7) — verify each against the current Avery template PDFs when implementing and correct the cited values in the source comment; **Dymo 30252** (28.6×89, **landscape composition** — content runs along the 89 mm axis), **Dymo 30334** (57×32), **Zebra 2.25"×1.25"** (57.2×31.8) as one-label-per-page thermal. Content per label: Code 128 (Phase 6 modules → filled black rects, min module width enforced — if value too long for label width, shrink to floor then truncate text layer with warning), SKU (always), optional product title (ellipsized) and price. Options: template, start offset (partially used Avery sheets), copies per variant, content toggles, font size. Composition is pure: `composeLabels(geometry, items, options) → Promise<Uint8Array>` using only pdf-lib + core. Standard fonts (Helvetica) only — no font files. Route streams the PDF (`Content-Disposition: attachment`).

**Tests:** re-open outputs with pdf-lib: page count math (37 items on 5160 → 2 pages; thermal → 37 pages), page dimensions per spec (±0.5pt), **absolute label origin (x,y) of the first, last, and one middle cell per template (±0.5pt) computed from margins+pitch** — page-count-only tests cannot catch margin errors, which are the difference between a working and a useless Avery print; start-offset placement; Dymo 30252 landscape orientation; barcode rect count matches encoder module count for a known value; long-title ellipsis; snapshot of drawing-op summaries (not raw bytes — pdf-lib output isn't byte-stable across versions).

**Acceptance:** in `dev:mock`, select fixture variants → download Avery 5160 and Dymo 30334 PDFs; files open in a viewer with visually correct layout (agent verifies structurally via tests; human eyeball is a bonus); all label tests green.

---

### Phase 8 — Bulk editor grid (Polaris)
**Goal:** Filterable, pageable grid of all variants with inline SKU/barcode editing (CAS-protected) and selection → actions (generate, print labels).

**Files:** `app/routes/app.editor.tsx`; `app/services/editor.server.ts`; `app/components/{VariantGrid.tsx, InlineSkuCell.tsx}`; tests.

**Key notes:** Data source = `catalog.listVariantsPage` — cursor-paginated interactive reads (**never `streamAllVariants`**: bulk ops are completion-gated and per-shop limited; an editor page-load must not launch a minutes-long bulk operation — the fake's exclusivity/completion-gate will fail any test wired that way). Filters: text search (title/SKU/barcode), vendor, product type, missing-SKU/missing-barcode passed through to the paged query's search syntax. **Duplicate-only toggle sources from the latest `DuplicateScan` findings** (variant-id list from `ScanFinding`s → `getVariants`), not an on-the-fly index — a partial paged window cannot compute store-wide duplicates; show the scan's timestamp with a "run fresh scan" link. Inline edit posts `{variantId, field, newValue, expectedValue}` → single-variant `updateVariants` CAS write; live duplicate check via `catalog.findVariantsBySku(newValue)` before submit (warn, allow explicit override — this is manual editing, not auto-generation; the hard guarantee applies to generated values, the editor *warns*). **Barcode-overwrite guard (shared predicate from `core/validate`, same as Phase 6/9):** editing a *non-empty* barcode field to a different value triggers a confirm interstitial naming the GS1 hazard ("this field may contain an official UPC/EAN"). Selection feeds "Generate for selected" (Phase 5) and "Print labels" (Phase 7). Free-plan variant-count awareness is displayed but not enforced yet.

**Tests:** editor service filter/paging logic over the 10k fixture via paged reads (page fetch < 1.5s; assert zero `streamAllVariants` calls); inline-edit CAS conflict surfaces a reload prompt; duplicate warning on entering an existing SKU; barcode-overwrite interstitial on non-empty barcode edit; duplicate-only filter reflects seeded scan findings; integration tests for loader/actions.

**Acceptance:** in `dev:mock`, grid loads over the 10k fixture with responsive paging/filtering; editing a SKU to a duplicate warns; a successful edit persists in the fake and survives refresh.

---

### Phase 9 — CSV export/import with pre-import validation
**Goal:** Round-trip CSV: export the grid's current filter set; import validates fully **before** anything touches the catalog.

**Files:** `app/core/csv/{schema.ts, exportCsv.ts, importCsv.ts, validateImport.ts}`; `app/services/csv.server.ts`; `app/routes/{app.csv.tsx, api.csv.export.ts}`; tests.

**Key notes:** Column schema: `variant_id, product_title, variant_title, vendor, sku, barcode` (+ readonly context columns ignored on import). Export via papaparse `unparse`, UTF-8 BOM (Excel), respects current editor filters. Import pipeline (all pure, in `core/csv`): parse (papaparse, tolerant of column reorder/extra columns) → structural validation (unknown/missing `variant_id`s vs catalog, non-string junk) → **duplicate validation**: within-file duplicates AND collisions against the full catalog index *excluding rows being changed* (the classic burn case from PLAN — catch before Shopify) → malformed check vs default rule (warning-level) → **barcode-overwrite guard (same shared `core/validate` predicate as Phases 6/8):** any row replacing a *non-empty* barcode with a different value is warn-level and excluded by default — applying those rows requires an explicit "include barcode overwrites" toggle with the GS1-hazard copy (a CSV import silently replacing real UPCs is the same review-killer PLAN warns about, through a different door) → **dry-run report screen** (per-row verdict: apply / no-op / warn / block; blocked rows never apply; user can apply "clean rows only") → apply via the Phase-5 job engine (`trigger:"csv"` reuses GenerationJob with proposals from the file, CAS from the file's original values, runs under the per-shop `JobLock` like every write job, post-run verification scan included). Row limit per import (e.g. 20k) with clear error.

**Tests:** round-trip fidelity (export → import → zero diffs); within-file dup, file-vs-catalog dup, swap case (two rows exchanging SKUs — must validate as clean); barcode-overwrite rows excluded by default and applied only with the explicit toggle; BOM/quoting/newline torture cases; unknown variant ids; dry-run report counts; partial apply ("clean rows only") leaves blocked rows untouched.

**Acceptance:** in `dev:mock`, export fixture CSV, mangle it (introduce a dup + an unknown id), re-import → report blocks exactly those rows, applying clean rows succeeds and rescan still shows 0 duplicates.

---

### Phase 10 — Duplicate-scan screen + nightly cron
**Goal:** The demo-that-sells-the-install: scan dashboard with "0 duplicate SKUs" hero stat, findings list with one-click fixes, and the nightly scheduled scan.

**Files:** `app/services/scan.server.ts`; `app/routes/{app.scan.tsx, app._index.tsx (dashboard hero stat), api.cron.scan.ts}`; `scripts/run-cron-local.mjs`; `app/components/FindingCard.tsx`; tests; `docs/CRON.md`.

**Key notes:** `runScan(shop, trigger)` streams the catalog through Phase-2 `scanCatalog`, persists `DuplicateScan` + `ScanFinding`s, computes totals. Scan screen: hero stat (big green "0 duplicate SKUs" or red count), findings grouped by kind, each duplicate group shows its variants with one-click **Fix** = single-variant generation job (`trigger:"fix"` — Phase 5's single-variant path: `findVariantsBySku` collision check, no full stream, runs under the `JobLock`) using the default rule via `assignUnique` (preview inline before confirm), or **Ignore** (resolution flag). Post-generation scans (`trigger:"post_generation"`) auto-run after Phase-5 jobs complete (cheap: reuse job's index instead of full rescan when possible). Cron: `POST /api/cron/scan` guarded by `Authorization: Bearer ${CRON_SECRET}`, iterates shops with scanning entitlement, runs scans sequentially with a per-shop time budget; invoked in prod by any external scheduler (Fly Machines cron / GitHub Actions / Supabase scheduled function — decision deferred to deploy time, documented in `docs/CRON.md`); locally by `npm run cron:local`. Endpoint is idempotent per day (skips shops already scanned since local midnight).

**Tests:** scan persistence + totals on small and 10k fixtures; fix flow resolves a seeded duplicate group and rescan drops the count; cron auth (401 without secret), per-day idempotency; ignore flow.

**Acceptance:** in `dev:mock`, dashboard shows the real duplicate count from the fixture; fixing all seeded duplicates turns the hero stat to "0 duplicate SKUs"; `npm run cron:local` triggers a scan and a second run the same day is a recorded no-op.

---

### Phase 11 — Billing & plan gating
**Goal:** Enforce the pricing matrix through `BillingGateway`, fully exercisable with the fake.

**Files:** `app/adapters/billing/{gateway.ts (finalize), shopifyBilling.ts, fakeBilling.ts}`; `app/services/entitlements.server.ts`; `app/routes/app.billing.tsx`; `PlanGate` component; gate call-sites added across Phases 5–10 routes; tests.

**Key notes:** Entitlement matrix (single source in `core/constants.ts`): **free** = ≤50 variants, manual generation only; **pro $12** = unlimited variants + auto-generation webhook + duplicate scanning (incl. nightly); **premium $19** = + label printing + CSV. `entitlements.can(shop, feature)` and `enforceVariantLimit(shop, catalog)` (free shops with >50 variants: read-only features keep working, generation blocked with upgrade CTA — never break an installed store). Real impl: `appSubscriptionCreate` mutation + confirmation redirect + `APP_SUBSCRIPTIONS_UPDATE` webhook updating `Shop.plan`; tested against recorded fixtures only. Fake: plan from `MOCK_PLAN` or a dev-only plan-switcher on the billing page in mock mode. Test-mode charges flag (`billing.test = true`) driven by env for the eventual dev store.

**Tests:** matrix truth-table tests; each gated route/action rejects below-plan (integration, per feature); variant-limit boundary (50/51); webhook fixture flips plan; fake switcher.

**Acceptance:** in `dev:mock` with `MOCK_PLAN=free`, label/CSV/auto-gen routes show upgrade CTAs and actions 403; `MOCK_PLAN=premium` unlocks everything; all prior phases' tests still green (gates default-open in their own test setups via fake premium).

---

### Phase 12 — Hardening, docs, go-live checklist
**Goal:** Production polish: error handling, GDPR webhooks, perf pass, docs, and the creds-drop-in runbook.

**Files:** `app/routes/webhooks.{app-uninstalled,customers-data-request,customers-redact,shop-redact}.ts`; error boundaries + toast/error patterns across routes; structured logger (`app/services/log.server.ts`); `docs/{GO_LIVE.md, ARCHITECTURE.md, CRON.md updates, TESTING.md}`; README refresh; final test sweep.

**Key notes:** Mandatory-for-listing webhooks: `app/uninstalled` (mark shop uninstalled, stop crons), the three GDPR topics (log + purge shop data for shop-redact). Audit every catalog write path for the CAS invariant and every generation path for the `assignUnique` funnel (add an architectural test: grep/import-graph assertion that no service calls `updateVariants` with a generated SKU that didn't pass through `assignUnique`). Perf: 10k scan and 10k generation benchmarks recorded in `TESTING.md`. `GO_LIVE.md`: exact steps to go from mock to live — Partner app creation, env vars, `shopify app deploy`, scope grant, webhook registration verification, billing test-charge walkthrough, first real-store scan smoke test, cron scheduler setup. Listing-prep notes (SEO keywords from PLAN: "SKU generator", "barcode generator", "SKU manager").

**Tests:** webhook handlers (fixture payloads, HMAC negative test); uninstall lifecycle; full-suite run with coverage report (target: `core/` ≥ 90% lines, services ≥ 75%).

**Acceptance:** `npm run check` green with coverage thresholds; `dev:mock` full manual walkthrough script in `TESTING.md` executes cleanly end-to-end (rules → generate → barcodes → labels → editor → CSV → scan → billing gates); `GO_LIVE.md` reviewed for completeness against `.env.example`.

---

## 5. Open questions & risks

1. **Week-0 competitor audit is a GATE, not a phase here.** PLAN.md mandates auditing the top 5–8 current "SKU generator"/"barcode generator" apps (does any now do auto-fill-both + duplicate validation + printing?) before committing to this wedge. That audit needs a human with App Store access and possibly trial installs — **it is not in this build plan and must produce a go/changed-wedge/deprioritize verdict before Phase 4+ UI investment.** Phases 0–3 are wedge-agnostic infrastructure and safe to build during the audit.
2. **Template drift (Remix → React Router 7).** The RR7 template is current as of mid-2026 but young; auth/session APIs (`@shopify/shopify-app-react-router`) may shift. Mitigation: Phase 0 pins exact versions and isolates template touchpoints to `shopify.server.ts` + `context.server.ts`.
3. **`productVariantsBulkUpdate` semantics.** It is per-product; per-call variant caps and cost weights need verification against live docs when creds arrive. The throttle layer is budget-driven so only constants should change. Also verify current API version's bulk-operation JSONL shape for variants + options.
4. **Barcode field overwrite hazard.** Merchants keep real GS1 UPCs in the barcode field; any default that overwrites non-empty barcodes is a review-killer. Phase 6 hard-guards this — keep the guard under test forever.
5. **Sequence gaps & merchant expectations.** Block allocation leaks sequence numbers on failed jobs. Judged acceptable (SKUs need uniqueness, not density) — but surface it in docs/FAQ; some merchants expect gapless.
6. **Grid over adapter vs local mirror.** Phase 8 reads through the catalog adapter with a streamed window rather than mirroring the catalog into Postgres. Simpler and always-fresh-ish, but 10k-store paging UX depends on stream batch latency; if real-store latency disappoints, the fallback is a `CatalogCache` table refreshed by scans (schema already tolerates adding it — revisit after Phase 8 perf numbers).
7. **Nightly cron scheduler choice** deferred to deployment (Fly cron vs GitHub Actions vs Supabase scheduled functions). The HTTP-endpoint design works with all three; pick at `GO_LIVE`.
8. **Prisma dual-schema drift.** Two schema files (sqlite/postgres) can diverge; `check-schema-sync` script guards it in CI, but the postgres schema is never *executed* until creds arrive — first live migration is a `GO_LIVE.md` checklist item with explicit verification.
9. **Free-plan "50 variants" definition** (total variants in store vs variants managed?) — assumed *total store variants* for gating simplicity; confirm against competitor norms during the week-0 audit.
10. **Polaris flavor** (React components vs newer web components) — Phase 0 records whatever the pinned template ships; don't mix flavors mid-build.

---

## Review revisions

Revised 2026-07-20 after adversarial review (see `PLAN_REVIEW.md` for full findings incl. MINORs not folded in). BLOCKER/MAJOR fixes incorporated above:

- **Cross-job uniqueness race (B1):** added `JobLock` (§2) — at most one catalog-writing job per shop; `assignUnique`'s guarantee is index-relative, so serialization + webhook point re-checks + a mandatory post-run verification scan are now stated as load-bearing invariants (§1.3, Phase 5), with adversarial cross-job tests.
- **Bulk-op abstraction leak (B2):** `ShopifyCatalog` gains `listVariantsPage` + `findVariantsBySku`; bulk operations (completion-gated, per-shop-limited) reserved for full scans/job plan steps; fake models exclusivity + completion gate; contract suite pins it (§1.3, Phases 3/4/8).
- **Mock-auth fail-open (B3):** mock mode is explicit opt-in, non-production only; missing prod creds = hard boot failure (§1.4, §3).
- **Webhook job cost (M1):** single-variant jobs use point lookups, never a full catalog stream (Phase 5, Phase 10 fix flow).
- **CAS honesty (M2):** re-fetch CAS documented as window-shrinking, not atomic; barcode never-overwrite enforced by predicate; verification scan as backstop (§1.3).
- **Barcode-overwrite guard extended (M3):** shared predicate now guards CSV import (default-excluded, explicit toggle) and bulk-editor inline edits (confirm interstitial), not just auto-generation (Phases 8/9).
- **Phase-order fix (M4):** read-only `peekSequence` moved to Phase 4; Phase 5 extends the same service with allocation — no forward dependency.
- **Label geometry (M5):** built-in templates now require full sheet math (margins, pitch, cols×rows, orientation, cited sources); tests assert absolute cell origins, not just page counts (Phase 7).
- **Contract-suite scope (M6):** enumerated minimum contract assertions incl. write grouping, error mapping, exclusivity, completion gate (Phase 3).
