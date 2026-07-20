import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import db from "../../app/db.server";
import { createRule, parseRuleConfig } from "../../app/services/rules.server";
import { fixFinding, getLatestScan, hasNightlyScanToday, ignoreFinding, previewFindingFix, runScan, utcDayStart } from "../../app/services/scan.server";
import { generateCatalog } from "../fixtures/gen-catalog";

const shopDomain = "phase10-scan.myshopify.test";

function variant(id: string, sku: string | null): CatalogVariant {
  return { productId: `p-${id}`, variantId: id, productTitle: `Product ${id}`, variantTitle: "Default", vendor: "Acme", productType: "Shirt", tags: [], options: { Size: "M" }, sku, barcode: null, price: "10.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" };
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

describe("duplicate scan service", () => {
  beforeEach(cleanShop);
  afterAll(async () => { await cleanShop(); await db.$disconnect(); });

  it("persists totals and every finding kind", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", "DUP"), variant("v2", "dup"), variant("v3", null), variant("v4", "bad value")]);
    const scan = await runScan({ db, catalog, shopDomain, trigger: "manual", skuPattern: /^[A-Z0-9-]+$/ });
    expect(scan.summary).toMatchObject({ variantsScanned: 4, duplicateGroups: 1, duplicateVariants: 2, malformed: 2, missingSku: 1 });
    expect(new Set(scan.findings.map((finding) => finding.kind))).toEqual(new Set(["duplicate", "malformed", "missing_sku", "missing_barcode"]));
    expect((await getLatestScan(db, shopDomain))?.summary.duplicateGroups).toBe(1);
  });

  it("uses the active default rule regex instead of the generic SKU shape", async () => {
    const catalog = new InMemoryShopifyCatalog([
      variant("v1", "SKU/ACM 01"),
      variant("v2", "GENERIC-123"),
    ]);
    await createRule(db, shopDomain, {
      name: "Slash and space rule",
      pattern: "SKU/{vendor:3} {seq:2}",
      config: parseRuleConfig({ casing: "upper", stripNonAlphanumeric: true }),
      isDefault: true,
    });

    const scan = await runScan({ db, catalog, shopDomain, trigger: "manual" });
    expect(scan.summary.malformed).toBe(1);
    expect(scan.findings.filter((finding) => finding.kind === "malformed")).toEqual([
      expect.objectContaining({ skuValue: "GENERIC-123" }),
    ]);
  });

  it("routes a one-click fix through generation and updates the verified hero count", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", "DUP"), variant("v2", "DUP"), variant("v3", "DUP")]);
    await createRule(db, shopDomain, { name: "Default", pattern: "{vendor:3}-{seq:4}", config: parseRuleConfig({}), isDefault: true });
    const scan = await runScan({ db, catalog, shopDomain, trigger: "manual" });
    const finding = scan.findings.find((entry) => entry.kind === "duplicate")!;
    const beforePreview = catalog.snapshot();
    const preview = await previewFindingFix({ db, catalog, shopDomain, findingId: finding.id });
    expect(preview.status).toBe("previewing");
    expect(preview.items.every((item) => item.proposedSku)).toBe(true);
    expect(catalog.snapshot()).toEqual(beforePreview);
    const result = await fixFinding({ db, catalog, shopDomain, findingId: finding.id });
    expect(result.job.status).toBe("completed");
    const latest = await getLatestScan(db, shopDomain);
    expect(latest?.trigger).toBe("post_generation");
    expect(latest?.summary.duplicateGroups).toBe(0);
    expect(new Set(catalog.snapshot().map((entry) => entry.sku)).size).toBe(3);
  });

  it("keeps a finding open when any one-click fix write is skipped", async () => {
    const catalog = new InMemoryShopifyCatalog(
      [variant("v1", "DUP"), variant("v2", "DUP")],
      { simulate: { conflictVariantIds: ["v2"] } },
    );
    await createRule(db, shopDomain, { name: "Default", pattern: "{vendor:3}-{seq:4}", config: parseRuleConfig({}), isDefault: true });
    const scan = await runScan({ db, catalog, shopDomain, trigger: "manual" });
    const finding = scan.findings.find((entry) => entry.kind === "duplicate")!;

    const result = await fixFinding({ db, catalog, shopDomain, findingId: finding.id });
    expect(result.job.status).toBe("completed_with_findings");
    await expect(db.scanFinding.findUniqueOrThrow({ where: { id: finding.id } })).resolves.toMatchObject({
      resolution: "open",
      resolvedAt: null,
    });
  });

  it("persists totals for a generated 10k catalog within the service budget", { timeout: 30_000 }, async () => {
    const catalog = new InMemoryShopifyCatalog(generateCatalog({ variants: 10_000 }));
    const started = performance.now();
    const scan = await runScan({ db, catalog, shopDomain, trigger: "manual" });
    const elapsed = performance.now() - started;
    console.info(`PERF persisted_scan_10k_ms=${elapsed.toFixed(1)}`);
    expect(scan.summary.variantsScanned).toBe(10_000);
    expect(await db.scanFinding.count({ where: { scanId: scan.id } })).toBe(scan.findings.length);
    expect(elapsed).toBeLessThan(30_000);
  });

  it("ignores a finding and uses UTC per-day nightly idempotency", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("v1", null)]);
    const scan = await runScan({ db, catalog, shopDomain, trigger: "nightly" });
    await ignoreFinding(db, shopDomain, scan.findings[0]!.id);
    const latest = await getLatestScan(db, shopDomain);
    expect(latest?.findings.some((finding) => finding.id === scan.findings[0]!.id)).toBe(false);
    expect(await hasNightlyScanToday(db, scan.shopId, new Date())).toBe(true);
    expect(utcDayStart(new Date("2026-07-20T23:59:59-05:00")).toISOString()).toBe("2026-07-21T00:00:00.000Z");
  });
});
