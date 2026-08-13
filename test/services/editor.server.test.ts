import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import { inlineEditVariant, listEditorPage } from "../../app/services/editor.server";
import { generateCatalog } from "../fixtures/gen-catalog";

const shopStub = { upsert: vi.fn(async () => ({ id: "shop-1", shopDomain: "test.myshopify.com" })) };
const dbStub = {
  shop: shopStub,
  duplicateScan: { findFirst: vi.fn(async () => null) },
} as unknown as Parameters<typeof listEditorPage>[0];

describe("editor service", () => {
  it("pages a 10k catalog interactively without starting a full-catalog stream", async () => {
    const fixture = generateCatalog({ variants: 10_000, seed: 89 });
    const catalog = new InMemoryShopifyCatalog(fixture);
    const streamSpy = vi.spyOn(catalog, "streamAllVariants");
    const started = performance.now();
    const page = await listEditorPage(dbStub, catalog, "test.myshopify.com", { pageSize: 50, filter: { vendor: "Acme" } });
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(page.variants.length).toBeLessThanOrEqual(50);
    expect(page.totalVariants).toBe(10_000);
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it("warns for an existing SKU, then writes with compare-and-set", async () => {
    const variants: CatalogVariant[] = [
      { productId: "p1", variantId: "v1", productTitle: "One", variantTitle: "Default", vendor: "A", productType: "Shirt", tags: [], options: {}, sku: "OLD", barcode: null, price: "1.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
      { productId: "p2", variantId: "v2", productTitle: "Two", variantTitle: "Default", vendor: "A", productType: "Shirt", tags: [], options: {}, sku: "TAKEN", barcode: null, price: "1.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
    ];
    const catalog = new InMemoryShopifyCatalog(variants);
    const updateSpy = vi.spyOn(catalog, "updateVariants");
    const warning = await inlineEditVariant(catalog, { variantId: "v1", field: "sku", newValue: "TAKEN", expectedValue: "OLD" });
    expect(warning).toEqual({ status: "warning", duplicateVariantIds: ["v2"], barcodeOverwrite: false });
    expect(updateSpy).not.toHaveBeenCalled();
    const applied = await inlineEditVariant(catalog, { variantId: "v1", field: "sku", newValue: "UNIQUE", expectedValue: "OLD" });
    expect(applied.status).toBe("applied");
    expect(updateSpy).toHaveBeenCalledWith([{ variantId: "v1", sku: "UNIQUE", expectedSku: "OLD" }]);
  });

  it("surfaces a CAS conflict as a reload prompt and guards barcode overwrite", async () => {
    const variant: CatalogVariant = { productId: "p1", variantId: "v1", productTitle: "One", variantTitle: "Default", vendor: "A", productType: "Shirt", tags: [], options: {}, sku: "CURRENT", barcode: "012345", price: "1.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" };
    const catalog = new InMemoryShopifyCatalog([variant]);
    const barcodeWarning = await inlineEditVariant(catalog, { variantId: "v1", field: "barcode", newValue: "999999", expectedValue: "012345" });
    expect(barcodeWarning).toMatchObject({ status: "warning", barcodeOverwrite: true });
    // The point of the warning is that the write is withheld pending consent.
    // Asserting only the returned status would pass even if the barcode had
    // already been overwritten.
    expect(catalog.snapshot().find((item) => item.variantId === "v1")?.barcode).toBe("012345");
    const conflict = await inlineEditVariant(catalog, { variantId: "v1", field: "sku", newValue: "NEXT", expectedValue: "STALE" });
    expect(conflict.status).toBe("conflict");
    if (conflict.status === "conflict") expect(conflict.message).toContain("Reload this row");
  });

  it("sources duplicate-only rows from the latest scan findings", async () => {
    const variants: CatalogVariant[] = [
      { productId: "p1", variantId: "v1", productTitle: "One", variantTitle: "Default", vendor: "A", productType: "Shirt", tags: [], options: {}, sku: "DUP", barcode: null, price: "1.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
      { productId: "p2", variantId: "v2", productTitle: "Two", variantTitle: "Default", vendor: "A", productType: "Shirt", tags: [], options: {}, sku: "DUP", barcode: null, price: "1.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
      { productId: "p3", variantId: "v3", productTitle: "Three", variantTitle: "Default", vendor: "A", productType: "Shirt", tags: [], options: {}, sku: "CLEAN", barcode: null, price: "1.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
    ];
    const scanDb = {
      shop: shopStub,
      duplicateScan: { findFirst: vi.fn(async () => ({ id: "scan-1", finishedAt: new Date("2026-07-20T00:00:00Z"), findings: [{ variants: JSON.stringify([{ variantId: "v1" }, { variantId: "v2" }]) }] })) },
    } as unknown as Parameters<typeof listEditorPage>[0];
    const page = await listEditorPage(scanDb, new InMemoryShopifyCatalog(variants), "test.myshopify.com", { duplicateOnly: true });
    expect(page.variants.map((variant) => variant.variantId)).toEqual(["v1", "v2"]);
  });
});
