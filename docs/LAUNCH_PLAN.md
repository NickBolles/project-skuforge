# SKUForge — Launch Plan

**Last updated:** 2026-08-13 (third pass, after execution)
**Audited against:** `main` @ `0f974e0`, live VPS deployment, live production database,
and the Partner Dashboard config pulled via `shopify app config link`.

**Third pass summary:** added the missing `[build]` block to `shopify.app.toml` (BLOCKER-A now does
what it says), version-controlled the VPS cron under `ops/cron/`, fixed MINOR-3, and re-audited
MINOR-2 as stale. The five human blockers below (B–H) are unchanged and still gate submission.
**Target:** Shopify App Store listing.

`docs/GO_LIVE.md` remains authoritative for env-var names and webhook paths.
See §7 for corrections to `DEPLOYMENT_HANDOFF.md`.

---

## 0. Headline: the honest timeline

| Milestone | Achievable in 1–2 days? | Notes |
|---|---|---|
| **Fully working, verified install on the `skuforge-lab` dev store** | ✅ **Yes** | Engineering blockers are now cleared. What remains is a human walkthrough. |
| **Submitted to the Shopify App Store for review** | ✅ Yes, day 2–3 | Gated on listing assets (icon, screenshots) and a real support inbox. |
| **Publicly listed and installable by merchants** | ❌ **No** | Shopify's review is a human queue that near-always returns at least one round of feedback. Budget **2–6 weeks** from submission. Outside your control. |

**Plan for "dev-store-complete in 1 day, submitted in 2–3 days."**

---

## 1. What changed in this pass

### ✅ Completed

| Item | What was done |
|---|---|
| **Shopify config reconciled** | `shopify.app.toml` had an empty `client_id` and no `application_url`/`[auth]` block. Linked against the Partner Dashboard; the file now carries the real identity fields. |
| **Nightly cron scheduled** | `/usr/local/bin/skuforge-cron-scan.sh` + `/etc/cron.d/skuforge-scan`, daily at 03:17 UTC. Verified: `http=200`, and idempotent on a second same-day call. |
| **Privacy policy published** | `/privacy` — live. Describes the data the code actually stores and the deletion paths `privacy.server.ts` actually implements. |
| **Support page published** | `/support` — live. Covers the GS1-honesty question, the uniqueness guarantee, plan gating, and cancellation. |
| **Landing page written** | `/` was still the template's "A short heading about [your app]" placeholder. Replaced. |
| **Broken test file fixed** | `healthz-route.test.ts` threw a TDZ error under the hoisted `vi.mock` factory, so it contributed **zero tests while the suite reported green**. The healthz endpoint had no effective coverage. |
| **Test suite made deterministic** | `fileParallelism: false`. Files share `prisma/dev.sqlite`, which caused nondeterministic cross-file failures. Now **191/191, repeatable**. |
| **CI now runs the tests** | Added schema-sync check, migrations, and `npm run test`. The suite did not gate merges at all before. |
| **Stranded webhook jobs recovered** | The nightly cron now drains `pending` webhook jobs for every installed shop, reporting `drainedWebhookJobs`. First-ever test coverage for `runNightlyScans`. |
| **Single-instance constraint documented** | `docs/GO_LIVE.md` §4a. |
| **Deployed** | `a5dc4c7` live. `/healthz`, `/`, `/privacy`, `/support` all 200; `/api/cron/scan` still 401s unauthenticated. |

### ⚠️ Correction to the first pass

**The first version of this document claimed no webhooks were registered. That was wrong.**

It inferred this from the empty `client_id` and the fact that `registerWebhooks` is never
called. But `shopify app config link` shows the **Partner Dashboard already declares all seven
webhook topics** — `app/uninstalled`, `app/scopes_update`, `app_subscriptions/update`,
`products/create`, and the three compliance topics — pointing at the correct URLs. The app config
was pushed at some earlier point from somewhere other than this working tree.

What was genuinely true: the local `shopify.app.toml` was **unlinked and incomplete**, and running
`shopify app deploy` from it would have overwritten the working Dashboard OAuth configuration.
That risk is now removed.

Webhook delivery is still **unproven end-to-end** — the production database has zero
`WebhookEvent` rows, because no product has been created on the dev store since install. That is a
gap in testing, not evidence of breakage.

---

## 2. Remaining blockers

### 🔴 BLOCKER-A — `shopify app deploy` (needs you)

**Time:** 5 min. **Blocked on:** it pushes the BLOCKER-B version decision, which is yours to make.

The reconciled config is committed but not pushed to Shopify. Run from the repo root:

```bash
shopify app deploy
```

You are already authenticated as `me@nickbolles.com`, so this should not re-prompt.
`shopify app config validate --json` reports `{"valid": true, "issues": []}`.

**What it changes:** pushes the webhook API version pin (see BLOCKER-B). Everything else in the
config already matches the Dashboard, so this is otherwise a no-op.

**Added 2026-08-13 — the `[build]` block the config was missing.** `shopify.app.toml` had no
`[build]` section at all, which mattered in two ways:

- `include_config_on_deploy` was unset. Without it, `shopify app deploy` can push extensions only
  and leave `[access_scopes]`, `[auth]`, and `[webhooks]` unapplied — a silent no-op that looks like
  a successful deploy. It is now explicitly `true`, so the command above does what this doc claims.
- `automatically_update_urls_on_dev` was unset. Left on, a local `shopify app dev` session rewrites
  `application_url`/`redirect_urls` to its tunnel and pushes them, repointing the live app at a
  tunnel that dies with the session. Now explicitly `false`.

`dev_store_url` is also set to `skuforge-lab.myshopify.com`, verified against the production `Shop`
and `Session` tables.

### 🔴 BLOCKER-B — Decide the webhook API version (needs your call)

The Partner Dashboard is on **`2026-07`**. The app's code calls the Admin API at
**`2025-10`** (`ApiVersion.October25` in `app/shopify.server.ts`, and the default in
`graphqlCatalog.ts`), and every recorded adapter fixture and contract test validates against
`2025-10`.

I set the toml to `2025-10` so that one consistent, fully-tested version applies everywhere. **My
recommendation, but it is your call**, and the tradeoff is real:

- **Pin to 2025-10 (what's committed):** launch on the version the whole test suite covers.
  Cost: `2025-10` leaves Shopify's supported window around **October 2026** — roughly two months
  out — so a bump is required soon after launch, with re-recorded fixtures.
- **Stay on 2026-07:** longer runway, no near-term deadline. Cost: webhook payloads arrive in a
  shape no test has ever exercised. I searched the changelog and found no breaking change to
  `products/create` payloads, but "no evidence of breakage" is weaker than "tested."

If you prefer 2026-07, change the one line in `shopify.app.toml` before running `shopify app deploy`.

### 🔴 BLOCKER-C — A real support email (needs you)

`app/config/brand.ts` currently has `support@skuforge.app`, **which I made up as a placeholder.**
Shopify requires a working support contact, and reviewers do test it. Set `SUPPORT_EMAIL` (and
`LEGAL_ENTITY`, currently just "SKUForge") to real values — it is a one-line change in that file,
and nothing else hardcodes them.

### 🔴 BLOCKER-D — Listing assets (needs you)

| Asset | Status |
|---|---|
| Privacy policy URL | ✅ `https://skuforge.srv1073822.hstgr.cloud/privacy` |
| Support URL | ✅ `https://skuforge.srv1073822.hstgr.cloud/support` |
| Support email | ❌ Placeholder — BLOCKER-C |
| App icon (1200×1200, no text) | ❌ Missing |
| Screenshots (≥3, 1600×900) | ❌ Missing — the guided dashboard, scan screen, and a label PDF are the natural three |
| Listing copy | ❌ Missing — build it on the SEO targets in `PLAN.md`: "SKU generator", "barcode generator", "SKU manager" |
| Pricing entered (Free / $12 / $19) | ❌ Not entered |

### 🔴 BLOCKER-E — Distribution type still "development app" (needs you)

Must be switched to **Public** in the Partner Dashboard before submission. Effectively one-way —
confirm this is the app you want listed first.

### 🔴 BLOCKER-F — Billing never exercised (needs you)

`BILLING_TEST=true` is set in production right now, and no subscription has ever been created.

Two things to settle:

1. **Test the loop:** approve a Pro test charge on the dev store, confirm
   `app_subscriptions/update` flips `Shop.plan`, confirm gated features unlock, cancel, confirm
   downgrade to Free. **Then set `BILLING_TEST=false`** in `/etc/vps-apps/skuforge.env` and redeploy.
2. **Resolve the model contradiction:** the code uses `appSubscriptionCreate` (the standard
   Billing API), while `DEPLOYMENT_HANDOFF.md` §5c insists on Shopify-managed pricing and says not
   to add recurring charges. Both are approvable; configuring both conflicts. The code as written
   expects the non-managed path.

### 🟠 BLOCKER-G — Real-store smoke test (needs you)

`docs/GO_LIVE.md` §4 has never been run. This matters more than its position suggests: **the
entire codebase is verified against mocks.** First contact with live Shopify is where the unknowns
are. Budget open-ended time.

The single highest-value item in it: **create a product on the dev store and confirm the
`products/create` webhook actually arrives**, creates one job, and that a replay is deduped. That
is the one thing that proves the Pro headline feature works in production — and it has never been
observed.

Also included: rule + preview, scan with manually reconciled totals, a small selected batch
(collision/CAS behavior), plan gating (51-variant Free store → clear 403), and printing one Avery
and one thermal PDF **at actual size** to check geometry and scannability.

### 🟠 BLOCKER-H — Competitor audit (needs you)

`PLAN.md` and `docs/GO_LIVE.md` §0 hard-gate public listing on auditing the current top 5–8 "SKU
generator" apps, ending in a build-as-planned / changed-wedge / deprioritize verdict. Never done.
Market gate, not engineering — but it should inform the listing copy, so do it before writing that.

---

## 3. Post-launch backlog

Ordered by revenue relevance. None blocking.

- **MINOR-8 — label-station UX.** `/app/labels` loads a single unfiltered 50-variant page with no
  search or paging, and the editor's "Print labels" hardcodes `avery-5160`. The PDF engine beneath
  it is the strongest part of the codebase. **This gates the $19 Premium tier** — highest-value
  item here.
- **API version bump to 2026-07** (if you take the 2025-10 pin) — requires re-recording adapter
  fixtures and re-running the contract suite. Deadline ~October 2026.
- ~~**MINOR-2 — fix-flow trust polish.**~~ **Stale — re-audited 2026-08-13 and largely untrue.**
  `fixFinding` (`app/services/scan.server.ts`) only marks a finding `fixed` when
  `items.every(status === "applied")`, so a `completed_with_skips` run leaves it `open`. And
  `previewFindingFix` is exported *and* wired to its own action in `app/routes/app.scan.tsx`, so the
  inline preview is not skipped. Nothing to fix here; the entry described code that no longer exists.
- ~~**MINOR-3 — sequence-bump collisions.**~~ **Fixed 2026-08-13.** `createBulkGenerationJob` now
  advances to the next free sequence number on a collision when the pattern carries a `{seq}` token,
  drawing each retry from the shared per-rule counter (the approach the barcode path already used) so
  a bumped number can never be one a concurrent job holds. `assignUnique` still backstops with a
  suffix after `SEQUENCE_BUMP_ATTEMPTS`. Covered by a new test in `generation.server.test.ts`.
- **MINOR-5 — coverage thresholds** never wired, despite Phase 12 requiring core ≥ 90% / services ≥ 75%.
- **MINOR-7 — full-catalog materialization.** Fine at 10k variants, a memory risk at 50–100k.
- **MINOR-9 — weak assertions** in two guard tests.
- **Restore test parallelism** by giving each worker its own SQLite file (currently serial, ~15s).
- **Deploy automation.** Deploys are manual; the release SHA is tracked by hand in
  `/etc/vps-apps/release-refs.env`.

---

## 4. Your next actions, in order

| # | Task | Time |
|---|---|---|
| 1 | Decide the API version (BLOCKER-B), then run `shopify app deploy` | 10 min |
| 2 | Set a real `SUPPORT_EMAIL` + `LEGAL_ENTITY` in `app/config/brand.ts`; redeploy | 15 min |
| 3 | **Create a product on the dev store; confirm the webhook fires** (BLOCKER-G, highest value) | 30 min |
| 4 | Billing test loop, then `BILLING_TEST=false` (BLOCKER-F) | 1 h |
| 5 | Rest of the `docs/GO_LIVE.md` §4 smoke test, incl. printing labels | 2–3 h |
| 6 | Competitor audit (BLOCKER-H) — parallelizable, hand to someone else | 4 h |
| 7 | Icon + screenshots + listing copy (BLOCKER-D) | 3–4 h |
| 8 | Switch to Public distribution (BLOCKER-E), enter pricing | 30 min |
| 9 | Submit | 30 min |

Items 6 and 7 have no dependency on 1–5 and can run in parallel.

**I can do, once you unblock me:** anything surfaced by the smoke test, the API version bump,
and the entire §3 backlog.

---

## 5. Operational notes

### ⚠️ Always deploy with `-p skuforge`

The running stack uses the Compose project name **`skuforge`**, but the checkout lives in
`/opt/vps-apps/project-skuforge/`, so a bare `docker compose up` infers the project name
`project-skuforge` and **silently builds a second, parallel stack with an empty database** — which
then attaches to Traefik under the same host rule and serves roughly half of all requests from a
database with no install in it. I hit exactly this during deployment and tore it down.

Correct deploy sequence:

```bash
cd /opt/vps-apps/project-skuforge && git fetch origin && git checkout <sha> && docker compose -p skuforge build web && docker compose -p skuforge up -d web
```

Then update `SKUFORGE_RELEASE` in `/etc/vps-apps/release-refs.env`.

### Nightly cron

`/etc/cron.d/skuforge-scan` runs `/usr/local/bin/skuforge-cron-scan.sh` daily at 03:17 UTC, logging
to `/var/log/skuforge-cron.log`. The script reads `SHOPIFY_APP_URL` and `CRON_SECRET` from
`/etc/vps-apps/skuforge.env` and strips CR — **that env file has CRLF line endings**, and an
unstripped `\r` corrupts the `Authorization` header (`curl: (43)`).

**Version-controlled as of 2026-08-13.** Both files previously existed only on the VPS, so a rebuilt
host would have lost the scheduler silently. They now live in `ops/cron/` — byte-identical to what
is running — alongside an idempotent `ops/cron/install.sh` and a logrotate config. See
`docs/CRON.md`. Re-run `sudo bash ops/cron/install.sh` after any deploy that touches `ops/cron/`.
A `.gitattributes` pins `*.sh`/`*.cron` to LF so a Windows checkout cannot reintroduce the CRLF bug
class above.

It currently returns `{"results":[]}` because the only installed shop is on the Free plan and
duplicate scanning is a Pro entitlement. This will start doing real work after the billing test.

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Live Shopify shapes differ from recorded fixtures | **High** | Delays the smoke test | Adapters sit behind ports, so fixes are localized. Budget open-ended time. |
| `products/create` never actually arrives in production | Medium | Kills the Pro value proposition | Task #3 above proves or disproves it in 30 minutes. Do it first. |
| App Store review returns feedback | **Very high** | 1–4 week delay | Normal. Pre-empt the usual failures: compliance webhooks, privacy policy, billing correctness, working support contact. |
| Competitor audit returns "changed wedge" | Medium | Repositioning | Run it in parallel now, not after submission. |
| 2025-10 leaves support before the bump lands | Medium | Forced migration under time pressure | Schedule the fixture re-record immediately post-launch. |
| Accidental second Compose stack | Medium | ~50% of requests hit an empty DB | §5 — always pass `-p skuforge`. |

---

## 7. Corrections to `DEPLOYMENT_HANDOFF.md`

| Claim | Reality |
|---|---|
| "there is **no `docker-compose.yml`** yet" | It exists and is in use (PR #14). |
| Hostnames are `*.nickbolles.com` | Actual: `skuforge.srv1073822.hstgr.cloud`. `env.production.example` still shows the `nickbolles.com` default. |
| "SKUForge 175 [tests]" | Now 191. |
| "All tests pass" | Was true only sequentially, and one file silently contributed zero tests. Both fixed — now genuinely 191/191. |
| §5c "use Shopify-managed App Pricing" | The code uses `appSubscriptionCreate`. Unresolved — BLOCKER-F. |
| Pinned Admin API version `2026-07` | **The handoff was right and the first version of this plan was wrong to flag it.** The Dashboard is on 2026-07; the *code* is on 2025-10. That mismatch is BLOCKER-B. |

One more note: the granted OAuth scope on `skuforge-lab` reads as `write_products` alone rather
than `read_products,write_products`. That is expected — Shopify implies read from write — not a defect.
