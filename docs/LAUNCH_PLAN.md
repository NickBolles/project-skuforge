# SKUForge — Launch Plan

**Last updated:** 2026-08-13 (fourth pass, after execution)
**Audited against:** `main` @ `0f974e0` plus the `chore/launch-config-cron-seqbump` branch, live VPS
deployment, and the Partner Dashboard config pulled via `shopify app config link`.

**Third pass summary:** added the missing `[build]` block to `shopify.app.toml` (BLOCKER-A now does
what it says), version-controlled the VPS cron under `ops/cron/`, fixed MINOR-3, and re-audited
MINOR-2 as stale.

**Fourth pass summary:** published `/terms`, stood up **encrypted nightly database backups**
(there were none — the only copy of production data was the live Docker volume), set
`BILLING_TEST=false` and deduplicated the production env file, and **settled the billing-model
contradiction in favour of `appSubscriptionCreate`** (BLOCKER-F item 2 closed). One new and
serious finding: **the `client_id` in `shopify.app.toml` does not match the `SHOPIFY_API_KEY` the
production app is running with** — see BLOCKER-0, which now gates BLOCKER-A.
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

### ✅ Completed in the fourth pass (2026-08-13)

| Item | What was done |
|---|---|
| **Terms of service published** | `/terms` — new. Covers plans and billing (the real `appSubscriptionCreate` model, both prices read from `PLAN_PRICES`), the GS1-vs-internal-barcode disclaimer as a *legal* limit rather than just an FAQ answer, catalog-write responsibility, warranty disclaimer, liability cap, and termination. Linked from the masthead and footer of every public page. **Live only after this branch deploys.** |
| **Encrypted nightly DB backups** | **There were none.** The only copy of production data was the live `skuforge-postgres` Docker volume. Now: `pg_dump` → `gzip -9` → AES-256-CBC/PBKDF2-200k nightly at 03:37 UTC, 14-day retention, version-controlled in `ops/backup/`, documented in `docs/BACKUPS.md`. Mirrors the AlertProof backup already on the host, so one restore procedure covers both. |
| **Backup verified end to end** | Not just written — the first run was decrypted, gunzipped, and confirmed to contain all 12 tables with their `COPY` data blocks. An untested backup is not a backup. |
| **`BILLING_TEST=false`** | Set in `/etc/vps-apps/skuforge.env` and confirmed inside the running container. See BLOCKER-F for the sequencing consequence. |
| **Production env file deduplicated** | Every key appeared **twice** — the example template header sat above the real values. Compose and the cron script both take the last occurrence, so the placeholders were inert, but the shadowed `TRAEFIK_CERTRESOLVER=letsencrypt` (real value: `mytlschallenge`) would have broken TLS the moment anything reordered the file. Backed up to `skuforge.env.bak-20260813-181936` first. |
| **Billing model decided** | `appSubscriptionCreate`, not Shopify-managed pricing. `DEPLOYMENT_HANDOFF.md` §5c corrected in place. |
| **Stale CRLF claim corrected** | The env file is LF-clean today, not CRLF as `docs/CRON.md` asserted. The `tr -d '\r'` guard stays anyway — the claim was wrong, the defence is still worth keeping. |

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

### 🚨 BLOCKER-0 — `client_id` and `SHOPIFY_API_KEY` name two different apps (needs you, do this first)

**Found 2026-08-13. This gates BLOCKER-A and must be resolved before `shopify app deploy` is run.**

| Where | Value |
|---|---|
| `shopify.app.toml` → `client_id` | `69080614dfec9869ce89fd6ccfec6776` |
| `/etc/vps-apps/skuforge.env` → `SHOPIFY_API_KEY` (and the live container) | `0ddd7fb0144d129658cd19834ab6b5de` |

A Shopify app's `client_id` **is** its API key. Two different values mean the repo config and the
running production app are pointed at **two different Partner Dashboard apps**.

Why this is dangerous rather than cosmetic: `shopify app deploy` writes to whichever app
`client_id` names. If `6908…` is the wrong one, that command pushes the scopes, `[auth]` block,
and all seven webhook subscriptions to an app **no merchant is installed on**, while the app that
is actually serving traffic keeps its old config — and the deploy reports success. That is
precisely the silent no-op the `[build]` fix in the third pass was meant to eliminate, arriving by
a different route.

**What we know:** the running container authenticates as `0ddd7fb0…`, and the `skuforge-lab`
install works against it — OAuth would fail outright otherwise. That is real evidence that
`0ddd7fb0…` is the live app. The counter-evidence is that the third pass ran
`shopify app config link` and the Dashboard app it linked to already declared all seven webhook
topics pointing at the correct production URLs. Both cannot be the same app.

The most likely explanation is that two apps were created during setup, the deployment was wired
to the first, and `config link` later picked the second from the list.

**How to resolve (5 minutes, Partner Dashboard):**

1. Open the Partner Dashboard app list. Expect to find **two** SKUForge-ish apps.
2. Identify which one `skuforge-lab.myshopify.com` is actually installed on. That one is
   authoritative — it holds the merchant install and the OAuth grant.
3. If the live app is `0ddd7fb0…` (most likely): change `client_id` in `shopify.app.toml` to
   `0ddd7fb0144d129658cd19834ab6b5de`, re-run `shopify app config link` against it to confirm the
   rest of the file matches, and **delete the unused app** so this cannot recur.
4. If the live app is genuinely `6908…`: update `SHOPIFY_API_KEY` **and** `SHOPIFY_API_SECRET` in
   `/etc/vps-apps/skuforge.env` together — they are a pair, and changing one alone breaks both
   OAuth and webhook HMAC verification. Every existing install must then re-authorize.

Do not guess. Confirm against the Dashboard before touching either value.

> Note: I could not settle this from the VPS. Reading the production `Shop`/`Session` tables would
> have identified the owning app directly, but those queries were blocked by this environment's
> permission policy. Everything else in this pass was verified against the live host.

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

**Added in the fourth pass:** `GOVERNING_LAW` in the same file is also a placeholder
(`"the State of Delaware, United States"`) and is named in §12 of the new `/terms` page. Set it to
the jurisdiction `LEGAL_ENTITY` is actually organized in. All three placeholders are flagged with
`⚠️` comments in `app/config/brand.ts`; nothing else in the codebase hardcodes them.

### 🔴 BLOCKER-D — Listing assets (needs you)

| Asset | Status |
|---|---|
| Privacy policy URL | ✅ `https://skuforge.srv1073822.hstgr.cloud/privacy` |
| Support URL | ✅ `https://skuforge.srv1073822.hstgr.cloud/support` |
| Terms of service URL | ⚠️ `https://skuforge.srv1073822.hstgr.cloud/terms` — written, live once this branch deploys. Set `GOVERNING_LAW` in `app/config/brand.ts` first (placeholder, see BLOCKER-C). |
| Support email | ❌ Placeholder — BLOCKER-C |
| App icon (1200×1200, no text) | ❌ Missing |
| Screenshots (≥3, 1600×900) | ❌ Missing — the guided dashboard, scan screen, and a label PDF are the natural three |
| Listing copy | ❌ Missing — build it on the SEO targets in `PLAN.md`: "SKU generator", "barcode generator", "SKU manager" |
| Pricing entered (Free / $12 / $19) | ❌ Not entered |

### 🔴 BLOCKER-E — Distribution type still "development app" (needs you)

Must be switched to **Public** in the Partner Dashboard before submission. Effectively one-way —
confirm this is the app you want listed first.

### 🔴 BLOCKER-F — Billing never exercised (needs you)

No subscription has ever been created.

**Item 2 is now closed.** The model contradiction is resolved: **SKUForge uses
`appSubscriptionCreate` — the standard Billing API — and *not* Shopify-managed pricing.** That is
what `app/adapters/billing/shopifyBilling.ts` implements, with prices in `PLAN_PRICES`
(`app/core/constants.ts`). `DEPLOYMENT_HANDOFF.md` §5c, which said the opposite, has been corrected
in place.

> **Consequence for the listing:** do **not** configure managed pricing in the Partner Dashboard.
> Configuring managed pricing *and* creating app subscriptions in code charges the merchant twice.
> Enter the plan names and prices on the listing for display only.

**Item 1 — the test loop — still needs running:** approve a Pro test charge on the dev store,
confirm `app_subscriptions/update` flips `Shop.plan`, confirm gated features unlock, cancel,
confirm downgrade to Free.

⚠️ **Sequencing changed 2026-08-13.** `BILLING_TEST` is now **`false`** in
`/etc/vps-apps/skuforge.env` — the correct production value, and verified in the running container.
But development stores only accept **test** charges, so with the flag false the walkthrough above
will fail with a Shopify error rather than producing a confirmation URL. **Flip it back to `true`
for the duration of the test, then return it to `false`:**

```bash
sudo sed -i 's/^BILLING_TEST=.*/BILLING_TEST=true/' /etc/vps-apps/skuforge.env
cd /opt/vps-apps/project-skuforge && docker compose -p skuforge up -d web
```

Reverse the `sed` when finished. Do not submit for review with it left `true`.

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
| 0 | **Resolve the `client_id` / `SHOPIFY_API_KEY` mismatch (BLOCKER-0). Do this before anything that runs `shopify app deploy`.** | 5 min |
| 0b | **Copy `/etc/vps-apps/skuforge-backup.key` off the VPS.** One command, and the backups are worthless without it. | 2 min |
| 1 | Decide the API version (BLOCKER-B), then run `shopify app deploy` | 10 min |
| 2 | Set a real `SUPPORT_EMAIL` + `LEGAL_ENTITY` + `GOVERNING_LAW` in `app/config/brand.ts`; redeploy | 15 min |
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
`/etc/vps-apps/skuforge.env` and strips CR, because an unstripped `\r` corrupts the `Authorization`
header (`curl: (43)`).

**Correction 2026-08-13:** earlier passes of this document asserted that env file *has* CRLF line
endings. It does not — it is LF-clean, and no CR is reaching the container's env values (checked
with `cat -A` on `SHOPIFY_API_SECRET`, `CRON_SECRET`, and `SCOPES`). The `tr -d '\r'` guard stays
regardless; the claim was wrong but the defence is cheap and the next hand-edit from a Windows
machine could make it true.

**Version-controlled as of 2026-08-13.** Both files previously existed only on the VPS, so a rebuilt
host would have lost the scheduler silently. They now live in `ops/cron/` — byte-identical to what
is running — alongside an idempotent `ops/cron/install.sh` and a logrotate config. See
`docs/CRON.md`. Re-run `sudo bash ops/cron/install.sh` after any deploy that touches `ops/cron/`.
A `.gitattributes` pins `*.sh`/`*.cron` to LF so a Windows checkout cannot reintroduce the CRLF bug
class above.

It currently returns `{"results":[]}` because the only installed shop is on the Free plan and
duplicate scanning is a Pro entitlement. This will start doing real work after the billing test.

### Encrypted database backups

**New 2026-08-13 — there were none before this.** The only copy of production data was the live
`skuforge-postgres` Docker volume; a volume loss or a bad migration would have been unrecoverable.

`/etc/cron.d/skuforge-backup` runs `/usr/local/bin/skuforge-backup.sh` daily at **03:37 UTC**,
twenty minutes after the scan so it captures the state the scan left rather than racing it. Output
is `pg_dump | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -iter 200000` to
`/var/backups/skuforge/`, mode `600`, 14-day retention, logging to syslog
(`journalctl -t skuforge-backup`).

Version-controlled in `ops/backup/` with an idempotent `install.sh`; full restore procedure and
design notes in **`docs/BACKUPS.md`**. Verified end to end on the first run — decrypted, gunzipped,
and confirmed to contain all 12 tables with their `COPY` data blocks.

> ⚠️ **The encryption key at `/etc/vps-apps/skuforge-backup.key` currently exists only on the
> VPS.** A backup encrypted with a key stored on the machine being backed up protects against
> nothing. Copy it to wherever `SHOPIFY_API_SECRET` is kept. This is the one part of the backup
> work an agent cannot finish for you.

Two limits worth knowing: the dumps are *logical*, so there is no point-in-time recovery and the
worst case is losing up to 24 hours; and they are stored **on the same host as the database**, so
they survive a bad migration or a dropped table but not a loss of the VPS itself. Shipping them
off-host is the natural next step.

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
| `shopify app deploy` pushes config to the wrong Partner app | **High until BLOCKER-0 is resolved** | Silent no-op; the live app keeps stale config while the deploy reports success | BLOCKER-0 — confirm which app `skuforge-lab` is installed on before deploying. |
| Backup encryption key lost with the host | **High while the key is only on the VPS** | Every backup becomes permanently unreadable | Copy `/etc/vps-apps/skuforge-backup.key` off-host. Task 0b. |
| VPS lost entirely | Low | Backups die with the database — they share a host | Ship the nightly `.enc` files off-host. Post-launch; the encryption is already done, so any dumb transport works. |

---

## 7. Corrections to `DEPLOYMENT_HANDOFF.md`

| Claim | Reality |
|---|---|
| "there is **no `docker-compose.yml`** yet" | It exists and is in use (PR #14). |
| Hostnames are `*.nickbolles.com` | Actual: `skuforge.srv1073822.hstgr.cloud`. `env.production.example` still shows the `nickbolles.com` default. |
| "SKUForge 175 [tests]" | Now 192. |
| "All tests pass" | Was true only sequentially, and one file silently contributed zero tests. Both fixed — now genuinely 192/192. |
| §5c "use Shopify-managed App Pricing" | **Resolved 2026-08-13 — the handoff was wrong for SKUForge.** The code uses `appSubscriptionCreate`, and that is the decided model. §5c has been corrected in place. Do not configure managed pricing in the Dashboard; doing both charges the merchant twice. AlertProof and CheckoutWatch are unaffected — verify their model separately rather than assuming it matches. |
| Pinned Admin API version `2026-07` | **The handoff was right and the first version of this plan was wrong to flag it.** The Dashboard is on 2026-07; the *code* is on 2025-10. That mismatch is BLOCKER-B. |

One more note: the granted OAuth scope on `skuforge-lab` reads as `write_products` alone rather
than `read_products,write_products`. That is expected — Shopify implies read from write — not a defect.
