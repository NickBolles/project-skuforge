import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogVariant, VariantWrite } from "../../app/adapters/shopify/catalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import db from "../../app/db.server";
import { createBulkGenerationJob, enqueueSingleVariantJob, runGenerationJob, SimulatedGenerationCrash } from "../../app/services/generation.server";
import { acquireJobLock, JobLockedError } from "../../app/services/job-lock.server";
import { handleProductsCreate } from "../../app/services/products-create.server";
import { createRule, ensureShop, parseRuleConfig } from "../../app/services/rules.server";
import { allocateSequenceBlock } from "../../app/services/sequence.server";
import { scanCatalog } from "../../app/core/validate";
import { generateCatalog } from "../fixtures/gen-catalog";
import { previewRule } from "../../app/services/preview.server";

const shopDomain = "phase5-generation.myshopify.test";
const baseConfig = parseRuleConfig({ casing: "upper", stripNonAlphanumeric: true });

function variant(id: string, sku: string | null, vendor = "Acme"): CatalogVariant {
  return { productId: `p-${id}`, variantId: id, productTitle: `Product ${id}`, variantTitle: "Default", vendor, productType: "Shirt", tags: [], options: { Size: "M" }, sku, barcode: null, price: "10.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" };
}

async function cleanShop() {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return;
  const scans = await db.duplicateScan.findMany({ where: { shopId: shop.id }, select: { id: true } });
  await db.scanFinding.deleteMany({ where: { scanId: { in: scans.map((scan) => scan.id) } } });
  await db.duplicateScan.deleteMany({ where: { shopId: shop.id } });
  const jobs = await db.generationJob.findMany({ where: { shopId: shop.id }, select: { id: true } });
  await db.generationJobItem.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } });
  await db.generationJob.deleteMany({ where: { shopId: shop.id } });
  await db.jobLock.deleteMany({ where: { shopId: shop.id } });
  await db.webhookEvent.deleteMany({ where: { shopId: shop.id } });
  await db.sequenceCounter.deleteMany({ where: { shopId: shop.id } });
  await db.skuRuleSet.deleteMany({ where: { shopId: shop.id } });
  await db.shop.delete({ where: { id: shop.id } });
}

async function rule(pattern = "{vendor:3}-{seq:4}", isDefault = false) {
  return createRule(db, shopDomain, { name: `Rule ${pattern}`, pattern, config: baseConfig, isDefault });
}

describe("generation jobs", () => {
  beforeEach(cleanShop);
  afterAll(async () => { await cleanShop(); await db.$disconnect(); });

  it("allocates non-overlapping sequence blocks concurrently", async () => {
    const shop = await ensureShop(db, shopDomain);
    const blocks = await Promise.all(Array.from({ length: 8 }, () => allocateSequenceBlock(db, shop.id, "rule:r", 25)));
    const values = blocks.flatMap((block) => Array.from({ length: block.size }, (_, offset) => block.start + offset));
    expect(new Set(values).size).toBe(200);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(200);
  });

  it("plans and applies all missing SKUs idempotently with a mandatory clean verification scan", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null), variant("v2", null), variant("v3", "EXISTING")]);
    const createdRule = await rule();
    const planned = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "bulk-idempotent" });
    expect(planned.items).toHaveLength(2);
    const same = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "bulk-idempotent" });
    expect(same.id).toBe(planned.id);
    const first = await runGenerationJob(db, catalog, planned.id);
    expect(first.job.status).toBe("completed");
    expect(first.verificationScanId).toBeTruthy();
    const afterFirst = catalog.snapshot();
    const second = await runGenerationJob(db, catalog, planned.id);
    expect(second.job.id).toBe(first.job.id);
    expect(catalog.snapshot()).toEqual(afterFirst);
    const scan = await scanCatalog(catalog.streamAllVariants());
    expect(scan.summary.duplicateGroups).toBe(0);
    expect(await db.duplicateScan.count({ where: { shopId: planned.shopId, trigger: "post_generation" } })).toBe(1);
  });

  it("selects the identical scoped variant set in preview and apply for all-missing and selected jobs", async () => {
    const catalog = new InMemoryShopifyCatalog([
      variant("v1", null, "Acme"),
      variant("v2", null, "Other"),
    ]);
    const scopedConfig = parseRuleConfig({
      casing: "upper",
      stripNonAlphanumeric: true,
      scope: { vendors: ["Acme"], productTypes: ["Shirt"], tags: [] },
    });
    const createdRule = await createRule(db, shopDomain, {
      name: "Scoped rule",
      pattern: "{vendor:3}-{seq:4}",
      config: scopedConfig,
    });
    const shop = await ensureShop(db, shopDomain);
    const preview = await previewRule({
      db,
      catalog,
      shopId: shop.id,
      ruleId: createdRule.id,
      pattern: createdRule.pattern,
      config: scopedConfig,
    });
    const allMissing = await createBulkGenerationJob(db, catalog, {
      shopDomain,
      ruleSetId: createdRule.id,
      trigger: "all_missing",
      idempotencyKey: "scope-parity-all-missing",
    });
    const selected = await createBulkGenerationJob(db, catalog, {
      shopDomain,
      ruleSetId: createdRule.id,
      trigger: "selected",
      selectedVariantIds: ["v1", "v2"],
      idempotencyKey: "scope-parity-selected",
    });

    const previewIds = preview.rows.map((row) => row.variantId);
    expect(allMissing.items.map((item) => item.variantId)).toEqual(previewIds);
    expect(selected.items.map((item) => item.variantId)).toEqual(previewIds);

    await runGenerationJob(db, catalog, allMissing.id);
    expect(catalog.snapshot().find((item) => item.variantId === "v1")!.sku).toMatch(/^ACM-/);
    expect(catalog.snapshot().find((item) => item.variantId === "v2")!.sku).toBeNull();
  });

  it("records compare-and-set conflicts as completed_with_skips", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null), variant("v2", "EXISTING")], { simulate: { conflictVariantIds: ["v1"] } });
    const createdRule = await rule();
    const job = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "cas-conflict" });
    const result = await runGenerationJob(db, catalog, job.id);
    expect(result.job.status).toBe("completed_with_skips");
    expect(JSON.parse(result.job.totals)).toMatchObject({ applied: 0, skippedConflict: 1, duplicateGroups: 0 });
  });

  it("resumes after a simulated crash by reaping the stale lock without reapplying completed items", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null), variant("v2", null)]);
    const updateSpy = vi.spyOn(catalog, "updateVariants");
    const createdRule = await rule();
    const job = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "resume" });
    await expect(runGenerationJob(db, catalog, job.id, { batchSize: 1, crashAfterBatches: 1 })).rejects.toBeInstanceOf(SimulatedGenerationCrash);
    await db.jobLock.update({ where: { shopId: job.shopId }, data: { heartbeatAt: new Date(0) } });
    const resumed = await runGenerationJob(db, catalog, job.id, { batchSize: 1, staleAfterMs: 1_000 });
    expect(resumed.job.status).toBe("completed");
    expect(JSON.parse(resumed.job.totals).applied).toBe(2);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it("dedupes webhook replay and point-checks before its compare-and-set write", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null), variant("v2", "ACM-0001")]);
    const lookupSpy = vi.spyOn(catalog, "findVariantsBySku");
    await rule("{vendor:3}-{seq:4}", true);
    const shop = await ensureShop(db, shopDomain);
    await db.shop.update({ where: { id: shop.id }, data: { settings: JSON.stringify({ autoGenerateOnCreate: true }) } });
    const first = await handleProductsCreate({ db, catalog, shopDomain, webhookId: "event-1", payload: { variantIds: ["v1"] }, plan: "premium" });
    const replay = await handleProductsCreate({ db, catalog, shopDomain, webhookId: "event-1", payload: { variantIds: ["v1"] }, plan: "premium" });
    expect(first.jobId).toBeTruthy();
    expect(replay).toMatchObject({ deduped: true, jobId: null });
    expect(await db.webhookEvent.count({ where: { shopId: shop.id } })).toBe(1);
    expect(await db.generationJob.count({ where: { shopId: shop.id } })).toBe(1);
    expect(lookupSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(catalog.snapshot().find((item) => item.variantId === "v1")!.sku).not.toBe("ACM-0001");
  });

  it("records an out-of-scope webhook variant as skipped without writing it", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null, "Other")]);
    await createRule(db, shopDomain, {
      name: "Acme only",
      pattern: "{vendor:3}-{seq:4}",
      config: parseRuleConfig({ scope: { vendors: ["Acme"], productTypes: [], tags: [] } }),
      isDefault: true,
    });
    const shop = await ensureShop(db, shopDomain);
    await db.shop.update({ where: { id: shop.id }, data: { settings: JSON.stringify({ autoGenerateOnCreate: true }) } });

    const result = await handleProductsCreate({
      db,
      catalog,
      shopDomain,
      webhookId: "event-out-of-scope",
      payload: { variantIds: ["v1"] },
      plan: "pro",
    });
    const job = await db.generationJob.findUniqueOrThrow({ where: { id: result.jobId! }, include: { items: true } });
    expect(job.status).toBe("completed_with_skips");
    expect(job.items).toEqual([
      expect.objectContaining({ variantId: "v1", status: "skipped_conflict", proposedSku: null }),
    ]);
    expect(catalog.snapshot()[0]!.sku).toBeNull();
  });

  it("keeps multiple variants from one webhook unique without a sequence token", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null), variant("v2", null), variant("v3", "OTHER")]);
    const createdRule = await rule("SAME", true);
    const job = await enqueueSingleVariantJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "webhook", idempotencyKey: "wh:multi", variantIds: ["v1", "v2"] });
    const result = await runGenerationJob(db, catalog, job.id, { source: "webhook" });
    expect(result.job.status).toBe("completed");
    expect(catalog.snapshot().filter((item) => item.variantId !== "v3").map((item) => item.sku)).toEqual(["SAME", "SAME-2"]);
  });

  it("advances to the next free sequence number instead of suffixing a taken one", async () => {
    // ACM-0001 is already taken, so the first target's allocated number collides.
    // It must land on a fresh four-digit number drawn from the rule counter, not
    // on the suffixed ACM-0001-2.
    const catalog = new InMemoryShopifyCatalog([variant("v1", null), variant("v2", null), variant("v3", "ACM-0001")]);
    const createdRule = await rule();
    const planned = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "seq-bump" });
    const proposed = planned.items.map((item) => item.proposedSku!);
    expect(proposed).toHaveLength(2);
    for (const sku of proposed) expect(sku).toMatch(/^ACM-\d{4}$/);
    expect(new Set([...proposed, "ACM-0001"]).size).toBe(3);

    const result = await runGenerationJob(db, catalog, planned.id);
    expect(result.job.status).toBe("completed");
    expect((await scanCatalog(catalog.streamAllVariants())).summary.duplicateGroups).toBe(0);
  });

  it("rejects a second UI job while the shop lock is held", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null)]);
    const createdRule = await rule();
    const job = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "ui-lock" });
    await acquireJobLock(db, { shopId: job.shopId, jobId: "other-job", kind: "csv" });
    await expect(runGenerationJob(db, catalog, job.id, { source: "ui" })).rejects.toBeInstanceOf(JobLockedError);
  });

  it("serializes adversarial bulk plus webhook jobs in a suffix-only namespace and leaves zero duplicates", async () => {
    class SlowCatalog extends InMemoryShopifyCatalog {
      override async updateVariants(writes: VariantWrite[]) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return super.updateVariants(writes);
      }
    }
    const catalog = new SlowCatalog([variant("v1", null), variant("v2", null), variant("v3", "UNRELATED")]);
    const createdRule = await rule("FIXED", true);
    const bulk = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "selected", selectedVariantIds: ["v1"], idempotencyKey: "adversarial-bulk" });
    const webhook = await enqueueSingleVariantJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "webhook", idempotencyKey: "wh:adversarial", variantIds: ["v2"] });
    const bulkRun = runGenerationJob(db, catalog, bulk.id, { source: "ui" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const webhookRun = await runGenerationJob(db, catalog, webhook.id, { source: "webhook" });
    expect(webhookRun.queued).toBe(true);
    await bulkRun;
    const final = catalog.snapshot();
    expect(final.find((item) => item.variantId === "v1")!.sku).toBe("FIXED");
    expect(final.find((item) => item.variantId === "v2")!.sku).toBe("FIXED-2");
    const scan = await scanCatalog(catalog.streamAllVariants());
    expect(scan.summary.duplicateGroups).toBe(0);
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: webhook.id } })).status).toBe("completed");
  });

  it("marks completed_with_findings when the mandatory verification scan catches an injected residual race", async () => {
    class RacingCatalog extends InMemoryShopifyCatalog {
      private injected = false;
      override async updateVariants(writes: VariantWrite[]) {
        const results = await super.updateVariants(writes);
        if (!this.injected && writes[0]?.sku) {
          this.injected = true;
          this.mutateVariant("v2", { sku: writes[0].sku });
        }
        return results;
      }
    }
    const catalog = new RacingCatalog([variant("v1", null), variant("v2", "OTHER")]);
    const createdRule = await rule("RACE");
    const job = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "verification-race" });
    const result = await runGenerationJob(db, catalog, job.id);
    expect(result.job.status).toBe("completed_with_findings");
    expect(JSON.parse(result.job.totals).duplicateGroups).toBe(1);
    expect(await db.scanFinding.count()).toBeGreaterThan(0);
  });

  it("processes a clean 10k catalog with 30% missing in under 30 seconds and verifies zero duplicates", { timeout: 30_000 }, async () => {
    const seed = generateCatalog({ variants: 10_000 }).map((item, index) => ({
      ...item,
      sku: index < 3_000 ? null : item.sku === "SEEDED-DUPLICATE-001" ? `REPAIRED-${index}` : item.sku,
    }));
    const catalog = new InMemoryShopifyCatalog(seed);
    const createdRule = await rule("{vendor:3}-{seq:6}");
    const started = performance.now();
    const job = await createBulkGenerationJob(db, catalog, { shopDomain, ruleSetId: createdRule.id, trigger: "all_missing", idempotencyKey: "stress-10k" });
    expect(job.items).toHaveLength(3_000);
    const result = await runGenerationJob(db, catalog, job.id, { batchSize: 250 });
    expect(result.job.status).toBe("completed");
    expect(JSON.parse(result.job.totals)).toMatchObject({ planned: 3_000, applied: 3_000, duplicateGroups: 0 });
    expect(performance.now() - started).toBeLessThan(30_000);
  });
});
