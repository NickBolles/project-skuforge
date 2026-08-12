# SKUForge — Launch Plan

**Audit date:** 2026-08-12
**Audited against:** `main` @ `92c4ae5`, live VPS deployment, live production database.
**Target:** Shopify App Store listing.

This document supersedes the launch-sequencing parts of `DEPLOYMENT_HANDOFF.md` (see §7 — that
document is stale in several specifics). `docs/GO_LIVE.md` remains authoritative for env-var
names and webhook paths.

---

## 0. Headline: the honest timeline

The user goal is "launch in 1–2 days." Splitting that into what is actually achievable:

| Milestone | Achievable in 1–2 days? | Notes |
|---|---|---|
| **Fully working, verified install on the `skuforge-lab` dev store** | ✅ **Yes** | This is ~1 focused day of work. Everything blocking it is small and known. |
| **Submitted to the Shopify App Store for review** | ✅ Yes, day 2–3 | Gated on listing assets (icon, screenshots, privacy policy) — mostly content work, not engineering. |
| **Publicly listed and installable by merchants** | ❌ **No** | Shopify's app review is a queue with human reviewers and near-always at least one round of feedback. Budget **2–6 weeks** from submission. This is outside your control and cannot be compressed. |

**So: plan for "dev-store-complete in 1 day, submitted in 2–3 days."** Treat the App Store
listing going live as a separate, later milestone.

The single most important finding: **the app has never been registered with Shopify via
`shopify app deploy`, so none of its webhooks are subscribed.** See BLOCKER-1. Everything
webhook-driven — the Pro headline automation, uninstall cleanup, billing plan changes, and all
three mandatory GDPR compliance topics — is currently dead in production. This is a ~30-minute
fix but nothing else matters until it is done.

---

## 1. Current status by component

### ✅ Working and verified

| Component | Status | Evidence |
|---|---|---|
| **Application code** | Feature-complete for MVP | All 12 phases implemented. Zero `TODO`/`FIXME`/`HACK` markers anywhere in `app/`. |
| **Test suite** | 185/185 pass sequentially | ⚠️ Flaky in parallel — see MEDIUM-1. |
| **Typecheck / lint / build** | Pass | `npm run check` pipeline green apart from the parallel-test flake. |
| **VPS deployment** | **Live and healthy** | `skuforge-web-1` + `skuforge-db-1` up 12 days. |
| **HTTPS / TLS / Traefik** | Working | `https://skuforge.srv1073822.hstgr.cloud/healthz` → `200 {"ok":true,"service":"web"}` |
| **Docker + Compose** | Working | `docker-compose.yml` present (web + `postgres:16-alpine` + persistent volume + Traefik labels). |
| **Postgres migrations** | Applied | `20260720123000_init` applied; all 11 app tables present in production. |
| **Dev-store install** | **Done** | Offline session exists for `skuforge-lab.myshopify.com` with a valid access token. `Shop` row created 2026-07-25, plan `free`. |
| **Cron endpoint auth** | Working | `POST /api/cron/scan` without a bearer token → `401`. |
| **Webhook HMAC rejection** | Working | `POST /webhooks/products-create` with no HMAC → `400` (rejected). |
| **Uniqueness guarantee (the product wedge)** | Genuinely implemented | `JobLock` serialization + point re-checks + mandatory post-run verification scan, all covered by adversarial tests including a 10k stress case. The gap audit found no path that can mint a duplicate. |
| **Prior gap-audit BLOCKER/MAJORs** | All closed | BLOCKER-1 (register `products/create`), MAJOR-1 (scope parity), MAJOR-2 (rule-aware malformed detection), MAJOR-3 (free-plan webhooks now 200-ack with `ignored_plan`) are all fixed in `5791280`. MINOR-1 and MINOR-6 also fixed. |

### ⚠️ Incomplete or unverified

| Component | Status |
|---|---|
| **Shopify app registration (`shopify.app.toml`)** | ❌ **Never linked or deployed.** `client_id = ""`, no `application_url`, no `[auth] redirect_urls`, no `name`/`handle`. No `.shopify/` directory. |
| **Webhook subscriptions** | ❌ **Almost certainly none registered.** See BLOCKER-1. |
| **Nightly duplicate-scan cron** | ❌ **Not scheduled.** No root crontab, no `/etc/cron.d` entry, no systemd timer on the VPS. |
| **App Store listing assets** | ❌ **None exist.** `public/` contains only `favicon.ico`. No privacy policy, no support page, no icon, no screenshots, no listing copy. |
| **Distribution type** | ❌ Still a development app; must be switched to Public to submit. |
| **Billing end-to-end** | ❌ Never exercised. `BILLING_TEST=true` in production right now. No subscription has ever been created. |
| **Real-store smoke test** | ❌ Not performed. `docs/GO_LIVE.md` §4 is entirely unrun. |
| **Competitor audit** | ❌ Not done. Self-imposed gate in `PLAN.md` and `docs/GO_LIVE.md` §0. |
| **CI test coverage** | ⚠️ CI never runs the test suite. |
| **Deploy automation** | ⚠️ Fully manual (git pull + `docker compose build` on the VPS). |

---

## 2. Blockers — must be fixed to launch

### 🔴 BLOCKER-1 — The app was never registered with Shopify; no webhooks are subscribed

**Severity:** Critical. Blocks everything.
**Time:** 30–45 min. **Requires human** (browser login to the Partner account).

**Evidence:**
- `shopify.app.toml` has `client_id = ""` and is missing `application_url`, `[auth] redirect_urls`, `name`, and `handle`.
- No `.shopify/` directory exists — the CLI has never linked this repo to the app.
- `app/shopify.server.ts:73` exports `registerWebhooks` but **nothing ever calls it**, and there is no `afterAuth` hook. Webhook registration is therefore *purely declarative* — it happens only when `shopify app deploy` pushes `shopify.app.toml` to Shopify.

**Impact — every one of these is currently broken in production:**
- `products/create` → the **Pro plan's headline feature** (auto-generate SKUs on new products) never fires on a real store.
- `app/uninstalled` → uninstalls never clean up sessions or shop data.
- `app_subscriptions/update` → **paid plans never activate.** A merchant could pay and stay on Free.
- `customers/data_request`, `customers/redact`, `shop/redact` → the three mandatory privacy webhooks are unregistered. **This alone fails App Store review.**

**Fix:**
```bash
npm i -g @shopify/cli
shopify app config link
```
Then verify the toml gained `client_id = "69080614dfec9869ce89fd6ccfec6776"`, `application_url = "https://skuforge.srv1073822.hstgr.cloud"`, and correct `[auth] redirect_urls`, and only then:
```bash
shopify app deploy
```

> ⚠️ **Sequencing warning:** do **not** run `shopify app deploy` before `config link`. Deploying
> the current blank toml risks overwriting the working App URL and redirect URLs in the Partner
> Dashboard (OAuth demonstrably works today, so that config is currently correct — don't clobber it).

**Verify after:** in the Partner Dashboard or via the Admin API, confirm all 7 topics are
subscribed and pointing at `https://skuforge.srv1073822.hstgr.cloud/webhooks/...`. Then send an
invalid-HMAC probe to each path and confirm rejection.

---

### 🔴 BLOCKER-2 — The nightly duplicate-scan cron is not scheduled

**Severity:** High. A paid feature silently never runs.
**Time:** 20–30 min. Can be done by an agent with VPS access.

**Evidence:** the VPS has no root crontab, no skuforge entry in `/etc/cron.d/`, and no systemd
timer. `/api/cron/scan` exists, is entitlement-gated and bearer-authenticated (verified 401
without a token), but **nothing ever calls it.**

**Fix:** add a daily systemd timer or `/etc/cron.d/skuforge-scan` entry that runs:
```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://skuforge.srv1073822.hstgr.cloud/api/cron/scan
```
Source `CRON_SECRET` from `/etc/vps-apps/skuforge.env` — do not inline it.

**Verify:** invoke twice in the same UTC day and confirm the second call is a no-op
(per-UTC-day idempotency, per `docs/CRON.md`).

---

### 🔴 BLOCKER-3 — No App Store listing assets exist

**Severity:** Critical for submission (not for dev-store testing).
**Time:** 4–8 h, mostly content/design. **Requires human** judgement.

`public/` contains only `favicon.ico`. Every one of the following is a hard submission requirement:

| Asset | Status | Notes |
|---|---|---|
| **Privacy policy URL** | ❌ Missing | Mandatory. Must cover what merchant/customer data is stored and the GDPR deletion path (the app already implements `privacy.server.ts` — describe it accurately). |
| **App icon** | ❌ Missing | 1200×1200, no text, no rounded corners. |
| **Screenshots** | ❌ Missing | Minimum 3, 1600×900. The new guided dashboard, scan screen, and a label PDF are the natural three. |
| **Support email + support URL** | ❌ Missing | Mandatory contact path. |
| **Listing copy** | ❌ Missing | `PLAN.md` already names the SEO targets — "SKU generator", "barcode generator", "SKU manager". Build the copy around those. |
| **Pricing details** | ❌ Not entered | Free / $12 Pro / $19 Premium. Must match what the code charges — see BLOCKER-5. |
| **Data-retention & deletion docs** | ❌ Missing | Called for by `docs/GO_LIVE.md` §5.4. |

---

### 🔴 BLOCKER-4 — Distribution type is still "development app"

**Severity:** Blocks submission. **Time:** 10 min. **Requires human.**

The app must be switched to **Public distribution** in the Partner Dashboard before it can be
submitted. Note this choice is effectively one-way — confirm the app is the one you want to list
before flipping it.

---

### 🔴 BLOCKER-5 — Billing has never been exercised, and the pricing model is ambiguous

**Severity:** High. **Time:** 1 h testing + a decision. **Requires human** (approving test charges).

Two distinct problems:

1. **Never tested.** No subscription has ever been created. `BILLING_TEST=true` is set in
   production right now. The upgrade → entitlement-change → downgrade loop is unverified — and it
   *cannot* work today because `app_subscriptions/update` is unregistered (BLOCKER-1).

2. **Model contradiction.** `app/adapters/billing/shopifyBilling.ts` uses the
   `appSubscriptionCreate` mutation (the standard Billing API). But `DEPLOYMENT_HANDOFF.md` §5c
   asserts all three apps use **Shopify-managed pricing** and says "do NOT add legacy recurring
   charges." Both approaches are valid and approvable, but **you must pick one** — configuring
   managed pricing in the Dashboard while the code also calls `appSubscriptionCreate` will
   conflict. The code as written expects the non-managed path.

**Fix:** resolve the model question, then with `BILLING_TEST=true` on the dev store: approve a Pro
test charge, confirm `app_subscriptions/update` flips the `Shop.plan` row, confirm gated features
unlock, cancel, confirm downgrade to Free. **Then set `BILLING_TEST=false` before submitting.**

---

### 🟠 BLOCKER-6 — The competitor-audit gate is unmet

**Severity:** Self-imposed but explicit. **Time:** ~4 h. **Requires human.**

`PLAN.md` and `docs/GO_LIVE.md` §0 both hard-gate public listing on a week-0 audit of the current
top 5–8 "SKU generator" / "barcode generator" / "SKU manager" apps, ending in a
build-as-planned / changed-wedge / deprioritize verdict. This has never been done. It is a market
gate, not an engineering one — it does not block dev-store testing, but it does block the decision
to list, and it should inform the listing copy.

---

### 🟠 BLOCKER-7 — The real-store smoke test has never been run

**Severity:** High confidence risk. **Time:** 2–3 h. **Requires human** (browser + physical printer).

`docs/GO_LIVE.md` §4 is entirely unrun. This matters more than its severity suggests: **the whole
codebase is verified against mocks.** Per the gap audit's own warning, the untested surface is
everything that only runs against live Shopify. Expect shape mismatches on first contact.

Run the full §4 list — create rule + preview, scan and manually reconcile totals, small selected
batch with collision/CAS checks, `products/create` webhook + replay dedupe, plan-gate checks
(51-variant Free store → clear 403), and print one Avery + one thermal PDF **at actual size** to
verify geometry and barcode scannability.

---

## 3. Non-blocking issues worth fixing

### 🟡 MEDIUM-1 — The test suite is flaky under parallelism

**Time:** 30 min–2 h.

Confirmed by three runs: sequential (`--no-file-parallelism`) → **185/185 pass**. Parallel → 1–2
failures, *different ones each run* (`rules-routes` seeing 2 rules where it expects 1;
`entitlement-routes` cleanup failing with "No record was found for a delete").

**Root cause:** every test file shares the single `prisma/dev.sqlite` file, so parallel workers
see each other's rows.

**Fix (quick):** set `fileParallelism: false` in `vitest.config.ts`. **Fix (proper):** give each
test file its own SQLite file via a per-worker `DATABASE_URL`.

This is worth fixing *before* wiring tests into CI, or CI will be red at random.

### 🟡 MEDIUM-2 — CI never runs the tests

**Time:** 15 min.

`.github/workflows/ci.yml` runs typecheck, lint, `prisma validate`, and build across a 3×3
node/manager matrix — but **never `npm run test`**. The 185-test suite that constitutes the app's
entire correctness argument does not gate merges. Add a test step (after MEDIUM-1).

### 🟡 MEDIUM-3 — No deploy automation

**Time:** 1–2 h if wanted.

Deploys are manual (`git pull` + `docker compose build` on the VPS), with the release SHA tracked
by hand in `/etc/vps-apps/release-refs.env`. Fine for now; worth a GitHub Actions deploy job
before you have merchants.

Production currently runs `08cff5e`; `main` is `92c4ae5`. The two-commit gap is **CI-workflow
changes only** — no application code differs. Production is functionally current.

### 🟡 MEDIUM-4 — Single-instance constraint is undocumented (gap audit MINOR-4)

`JobLock` is DB-backed and multi-instance safe, but the bulk-operation mutex
(`withCatalogBulkMutex`) and the pending-webhook-job drain live in **process memory**. Two web
instances would break both. The compose file runs exactly one instance, so this is correct today —
but nothing says so. Document it in `docs/GO_LIVE.md`, and wire `drainPendingWebhookJobs` into the
cron endpoint so webhook jobs stranded by a crash get picked up.

### 🟢 Remaining gap-audit backlog (all post-launch)

Still open from `GAP_REPORT.md` §A, none blocking:

- **MINOR-2** — one-click Fix skips the planned inline preview and marks findings `fixed`
  unconditionally, even when the run ended `completed_with_skips`. This is on the demo path that
  sells the install; worth doing early.
- **MINOR-3** — the sequence-bump collision strategy exists in `app/core/validate/assign.ts` but
  no caller passes it, so collisions always resolve to `-2`/`-3` suffixes (`ABC-0005-2`) where
  `ABC-0006` was intended and free. Cosmetic, but merchants notice.
- **MINOR-5** — no coverage thresholds wired, despite Phase 12 requiring core ≥ 90% / services ≥ 75%.
- **MINOR-7** — services materialize the full catalog in memory; fine at 10k, a risk at 50–100k variants.
- **MINOR-8** — **label-station UX**: `/app/labels` loads a single unfiltered 50-variant page with
  no search or paging, and the editor's "Print labels" hardcodes `avery-5160`. The PDF engine
  underneath is the strongest part of the codebase. **This gates the $19 Premium hook** — highest
  revenue-relevant item on this list.
- **MINOR-9** — two guard tests use weak/self-referential assertions.

---

## 4. Execution plan

### Day 1 — Make the dev store fully work

Do these **in order**; each unblocks the next.

| # | Task | Owner | Time | Blocks |
|---|---|---|---|---|
| 1 | `shopify app config link`, verify toml, `shopify app deploy` (**BLOCKER-1**) | Human | 45 min | Everything |
| 2 | Verify all 7 webhook topics registered; invalid-HMAC probe each path | Agent | 20 min | 3, 4 |
| 3 | Schedule the nightly cron + verify double-invoke idempotency (**BLOCKER-2**) | Agent | 30 min | — |
| 4 | Billing test loop: Pro upgrade → entitlement flip → cancel → Free (**BLOCKER-5**) | Human | 1 h | 5 |
| 5 | Full `docs/GO_LIVE.md` §4 real-store smoke test (**BLOCKER-7**) | Human | 2–3 h | Submission |
| 6 | Fix any live-Shopify shape mismatches surfaced by #5 | Agent | ??? | Submission |

**Parallel with the above (no dependency on #1):**

| Task | Owner | Time |
|---|---|---|
| Fix the parallel-test flake (**MEDIUM-1**) | Agent | 30 min–2 h |
| Add `npm run test` to CI (**MEDIUM-2**) — after the flake fix | Agent | 15 min |
| Document the single-instance constraint + drain webhook jobs from cron (**MEDIUM-4**) | Agent | 45 min |
| Competitor audit (**BLOCKER-6**) | Human | 4 h |
| Draft listing copy, privacy policy, support page (**BLOCKER-3**) | Human | 3–4 h |

> **Budget explicitly for task #6.** The entire codebase is mock-verified. First contact with live
> Shopify is where the unknowns are, and it is the one line item that cannot be estimated honestly
> in advance.

### Day 2 — Prepare the submission

| # | Task | Owner | Time |
|---|---|---|---|
| 7 | Produce app icon (1200×1200) + ≥3 screenshots (1600×900) | Human | 2–3 h |
| 8 | Publish privacy policy + support page at stable URLs | Human/Agent | 1–2 h |
| 9 | Switch distribution to Public (**BLOCKER-4**) | Human | 10 min |
| 10 | Enter pricing (Free / $12 / $19) matching the code's charges | Human | 30 min |
| 11 | **Set `BILLING_TEST=false`** and redeploy | Agent | 10 min |
| 12 | Final pass: re-run smoke tests against the production config | Agent | 1 h |
| 13 | Submit for review | Human | 30 min |

### Day 3+ — While in the review queue

Work the backlog in revenue order: **MINOR-8 (label station UX — gates the $19 tier)** first, then
MINOR-2 (fix-flow trust polish, on the demo path), then MINOR-3/5/7/9.

---

## 5. What needs a human vs. what an agent can do

**Human-only (cannot be automated):**
- Partner Dashboard browser login → `shopify app config link` / `shopify app deploy` (BLOCKER-1)
- Switching distribution to Public (BLOCKER-4)
- Approving test charges (BLOCKER-5)
- Competitor audit + verdict (BLOCKER-6)
- Printing labels at actual size and physically scanning the barcodes (BLOCKER-7)
- App icon, screenshots, listing copy, privacy policy content (BLOCKER-3)
- Submitting for review

**Agent-executable with existing VPS access:**
- Cron scheduling and idempotency verification (BLOCKER-2)
- Webhook registration verification and HMAC probes
- Test-flake fix, CI test step, ops docs (MEDIUM-1/2/4)
- All GAP_REPORT backlog items
- Redeploys and config changes

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Live Shopify API shapes differ from the recorded fixtures | **High** | Delays day 1 | Budget open-ended time for task #6; the adapters are behind ports, so fixes are localized. |
| `shopify app deploy` clobbers the working Partner Dashboard URLs | Medium | Breaks OAuth | `config link` **before** `deploy`; screenshot the current Dashboard config first. |
| App Store review returns feedback | **Very high** | 1–4 week delay | Normal. Pre-empt the common failures: GDPR webhooks (BLOCKER-1), privacy policy, billing correctness. |
| Competitor audit returns a "changed wedge" verdict | Medium | Rework of positioning | Do it in parallel on day 1, not after submission. |
| Merchant with a 50k+ variant catalog | Low near-term | Memory pressure | MINOR-7; single instance handles 10k comfortably today. |
| Random CI/test failures erode trust in the suite | High if unfixed | Slows every future change | MEDIUM-1, ~30 min. |

---

## 7. Corrections to `DEPLOYMENT_HANDOFF.md`

That document was written before the deployment happened and is stale in ways that will mislead:

| Claim | Reality |
|---|---|
| "there is **no `docker-compose.yml`** yet" | It exists and is in use (added in PR #14). |
| Hostnames are `*.nickbolles.com` | Actual deployment is `skuforge.srv1073822.hstgr.cloud`. `SKUFORGE_HOSTNAME` in the VPS env reflects the real host; `env.production.example` still shows the `nickbolles.com` default. |
| "Re-confirm the pinned Admin API version **`2026-07`**" | The app pins **`2025-10`** (`ApiVersion.October25` in `app/shopify.server.ts`, `api_version = "2025-10"` in the toml). Consistent internally; the handoff doc is simply wrong. |
| "SKUForge 175 [tests]" | Now 185 (dashboard + healthz route tests were added). |
| "All tests pass" | True only sequentially — see MEDIUM-1. |
| §5c "use Shopify-managed App Pricing, do NOT add legacy recurring charges" | The code uses `appSubscriptionCreate`. Contradiction to resolve — see BLOCKER-5. |

One more note: the granted OAuth scope on `skuforge-lab` reads as `write_products` alone rather
than `read_products,write_products`. This is **expected** — Shopify implies read access from
write — and is not a defect.
