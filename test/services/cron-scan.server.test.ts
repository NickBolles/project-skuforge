import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import db from "../../app/db.server";
import { runNightlyScans } from "../../app/services/cron-scan.server";
import { enqueueSingleVariantJob, runGenerationJob } from "../../app/services/generation.server";
import { createRule } from "../../app/services/rules.server";

const shopDomain = "cron-drain.myshopify.test";

function variant(id: string, sku: string | null): CatalogVariant {
  return {
    productId: `p-${id}`,
    variantId: id,
    productTitle: `Product ${id}`,
    variantTitle: "Default",
    vendor: "Acme",
    productType: "Shirt",
    tags: [],
    options: { Size: "M" },
    sku,
    barcode: null,
    price: "10.00",
    status: "ACTIVE",
    updatedAt: "2026-01-01T00:00:00Z",
  };
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
  await db.sequenceCounter.deleteMany({ where: { shopId: shop.id } });
  await db.skuRuleSet.deleteMany({ where: { shopId: shop.id } });
  await db.webhookEvent.deleteMany({ where: { shopId: shop.id } });
  await db.shop.delete({ where: { id: shop.id } });
}

/**
 * Reproduces the real stranding path: a webhook job that arrived while another
 * job held the shop's JobLock is parked as `pending`, and nothing drains it
 * until some later job happens to run in that shop.
 */
async function strandWebhookJob(catalog: InMemoryShopifyCatalog, variantId: string) {
  // createRule creates the Shop row via ensureShop, so it has to come first.
  const rule = await createRule(db, shopDomain, {
    name: "Default",
    pattern: "{vendor:3}-{seq:4}",
    isDefault: true,
  });
  const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain } });

  // Hold the lock so the webhook job cannot run inline.
  await db.jobLock.create({
    data: { shopId: shop.id, jobId: "held-by-another-job", kind: "bulk" },
  });

  const job = await enqueueSingleVariantJob(db, catalog, {
    shopDomain,
    ruleSetId: rule.id,
    trigger: "webhook",
    idempotencyKey: `wh:${variantId}`,
    variantIds: [variantId],
  });
  const result = await runGenerationJob(db, catalog, job.id, { source: "webhook" });
  expect(result.queued).toBe(true);
  expect((await db.generationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("pending");

  // The other job finishes (or its process crashed and the lock was reaped).
  await db.jobLock.deleteMany({ where: { shopId: shop.id } });
  return job.id;
}

describe("nightly cron", () => {
  beforeEach(cleanShop);
  afterAll(async () => {
    await cleanShop();
    await db.$disconnect();
  });

  it("drains a webhook job stranded by a busy lock", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null)]);
    const jobId = await strandWebhookJob(catalog, "v1");

    const results = await runNightlyScans({
      db,
      catalogForShop: async () => catalog,
    });

    expect(results[0]).toMatchObject({ shopDomain, drainedWebhookJobs: 1 });
    const drained = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(drained.status).toMatch(/^completed/);
    expect((await catalog.getVariants(["v1"]))[0]!.sku).toBeTruthy();
  });

  it("drains stranded jobs even when the shop cannot be scanned", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null)]);
    const jobId = await strandWebhookJob(catalog, "v1");

    const results = await runNightlyScans({
      db,
      catalogForShop: async () => catalog,
      canScan: async () => false,
    });

    expect(results[0]?.drainedWebhookJobs).toBe(1);
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: jobId } })).status).toMatch(/^completed/);
    // Not entitled to scanning, so no *nightly* scan ran. (The drained job still
    // runs its own mandatory post-generation verification scan — that is the
    // uniqueness guarantee, not the nightly sweep.)
    const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain } });
    expect(await db.duplicateScan.count({ where: { shopId: shop.id, trigger: "nightly" } })).toBe(0);
  });

  it("reports zero drained jobs when there is nothing stranded", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", "ACM-0001")]);
    await db.shop.create({ data: { shopDomain } });

    const results = await runNightlyScans({
      db,
      catalogForShop: async () => catalog,
    });

    expect(results[0]).toMatchObject({ shopDomain, status: "completed", drainedWebhookJobs: 0 });
  });

  it("is idempotent for the same UTC day", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", "ACM-0001")]);
    await db.shop.create({ data: { shopDomain } });

    const now = new Date("2026-08-12T04:00:00Z");
    await runNightlyScans({ db, now, catalogForShop: async () => catalog });
    const second = await runNightlyScans({ db, now, catalogForShop: async () => catalog });

    expect(second[0]).toMatchObject({ shopDomain, status: "skipped_already_scanned" });
  });
});
