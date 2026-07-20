import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import { INTERNAL_BARCODE_HONESTY_COPY } from "../../app/core/barcode";
import { scanCatalog } from "../../app/core/validate";
import db from "../../app/db.server";
import {
  createBulkBarcodeGenerationJob,
  runGenerationJob,
  saveBarcodeSettings,
} from "../../app/services/generation.server";

const shopDomain = "phase6-barcodes.myshopify.test";

function variant(id: string, barcode: string | null): CatalogVariant {
  return {
    productId: `p-${id}`,
    variantId: id,
    productTitle: `Product ${id}`,
    variantTitle: "Default",
    vendor: "Acme",
    productType: "Shirt",
    tags: [],
    options: {},
    sku: `SKU-${id}`,
    barcode,
    price: "12.00",
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
  await db.shop.delete({ where: { id: shop.id } });
}

describe("barcode generation jobs", () => {
  beforeEach(cleanShop);
  afterAll(async () => { await cleanShop(); await db.$disconnect(); });

  it("fills only empty barcodes, avoids collisions, and blocks a post-preview merchant barcode", async () => {
    const catalog = new InMemoryShopifyCatalog([
      variant("v1", null),
      variant("v2", "880001"),
      variant("v3", ""),
    ]);
    await saveBarcodeSettings(db, shopDomain, { prefix: "88", digits: 4, startNumber: 1 });
    const job = await createBulkBarcodeGenerationJob(db, catalog, {
      shopDomain,
      trigger: "all_missing",
      idempotencyKey: "barcode-fill",
    });

    expect(job.items).toHaveLength(2);
    expect(job.items.map((item) => item.proposedBarcode).sort()).toEqual(["880002", "880003"]);
    catalog.mutateVariant("v3", { barcode: "MERCHANT-UPC" });

    const result = await runGenerationJob(db, catalog, job.id);
    expect(result.job.status).toBe("completed_with_skips");
    const snapshot = catalog.snapshot();
    expect(snapshot.find((item) => item.variantId === "v1")!.barcode).toBe("880003");
    expect(snapshot.find((item) => item.variantId === "v2")!.barcode).toBe("880001");
    expect(snapshot.find((item) => item.variantId === "v3")!.barcode).toBe("MERCHANT-UPC");
    expect((await scanCatalog(catalog.streamAllVariants())).summary.duplicateBarcodeGroups).toBe(0);
  });

  it("ships the fixed GS1 honesty copy", () => {
    expect(INTERNAL_BARCODE_HONESTY_COPY).toContain("not GS1 UPC or EAN");
    expect(INTERNAL_BARCODE_HONESTY_COPY).toContain("licensed through GS1");
  });
});
