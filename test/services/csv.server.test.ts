import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import { scanCatalog } from "../../app/core/validate";
import db from "../../app/db.server";
import { applyCsvImport, dryRunCsvImport } from "../../app/services/csv.server";

const shopDomain = "phase9-csv.myshopify.test";

function variant(id: string, sku: string): CatalogVariant {
  return { productId: `p-${id}`, variantId: id, productTitle: `Product ${id}`, variantTitle: "Default", vendor: "Acme", productType: "Shirt", tags: [], options: {}, sku, barcode: null, price: "10.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" };
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
  await db.shop.delete({ where: { id: shop.id } });
}

describe("CSV import service", () => {
  beforeEach(cleanShop);
  afterAll(async () => { await cleanShop(); await db.$disconnect(); });

  it("flags in-file and catalog duplicates, clears an A<->B swap, and applies with zero post-run duplicates", async () => {
    const catalog = new InMemoryShopifyCatalog([
      variant("v1", "A"),
      variant("v2", "B"),
      variant("v3", "C"),
      variant("v4", "D"),
      variant("v5", "TAKEN"),
      variant("v6", "F"),
    ]);
    const writeSpy = vi.spyOn(catalog, "updateVariants");
    const csv = [
      "variant_id,product_title,variant_title,vendor,sku,barcode",
      "v1,,,,B,",
      "v2,,,,A,",
      "v3,,,,DUP,",
      "v4,,,,DUP,",
      "v6,,,,TAKEN,",
    ].join("\r\n");

    const dryRun = await dryRunCsvImport(db, catalog, shopDomain, csv);
    expect(dryRun.rows.filter((row) => row.issues.some((issue) => issue.code === "in_file_duplicate_sku")).map((row) => row.row.variant_id).sort()).toEqual(["v3", "v4"]);
    expect(dryRun.rows.find((row) => row.row.variant_id === "v6")!.issues.map((issue) => issue.code)).toContain("catalog_duplicate_sku");
    expect(dryRun.rows.filter((row) => ["v1", "v2"].includes(row.row.variant_id)).map((row) => row.verdict)).toEqual(["apply", "apply"]);
    expect(dryRun).toMatchObject({ counts: { apply: 2, block: 3 }, applyCount: 2 });

    const applied = await applyCsvImport(db, catalog, shopDomain, csv, { idempotencyKey: "csv-dups-and-swap" });
    expect(applied.job.status).toBe("completed");
    const swapBatch = writeSpy.mock.calls.find(([writes]) => writes.some((write) => write.variantId === "v1"));
    expect(swapBatch?.[0].map((write) => write.variantId)).toEqual(["v1", "v2"]);
    const snapshot = catalog.snapshot();
    expect(snapshot.find((item) => item.variantId === "v1")!.sku).toBe("B");
    expect(snapshot.find((item) => item.variantId === "v2")!.sku).toBe("A");
    expect(snapshot.find((item) => item.variantId === "v3")!.sku).toBe("C");
    expect(snapshot.find((item) => item.variantId === "v4")!.sku).toBe("D");
    expect(snapshot.find((item) => item.variantId === "v6")!.sku).toBe("F");
    expect((await scanCatalog(catalog.streamAllVariants())).summary).toMatchObject({
      duplicateGroups: 0,
      duplicateBarcodeGroups: 0,
    });
    expect(await db.duplicateScan.count({ where: { shopId: applied.job.shopId, trigger: "post_generation" } })).toBe(1);
  });
});
