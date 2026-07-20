import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import { createLabelsPdf } from "../../app/services/labels.server";

function variant(id: string): CatalogVariant {
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
    barcode: `8800${id}`,
    price: "12.00",
    status: "ACTIVE",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("label PDF service", () => {
  it("creates a reopenable PDF for selected variants and copies", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("01"), variant("02")]);
    const bytes = await createLabelsPdf(catalog, {
      templateId: "dymo-30334",
      variantIds: ["02", "01"],
      copies: 2,
      includePrice: true,
      includeProductName: true,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
  });

  it("rejects empty or stale selections", async () => {
    const catalog = new InMemoryShopifyCatalog([variant("01")]);
    await expect(createLabelsPdf(catalog, { templateId: "avery-5160", variantIds: [] })).rejects.toThrow(/at least one/);
    await expect(createLabelsPdf(catalog, { templateId: "avery-5160", variantIds: ["missing"] })).rejects.toThrow(/no longer exist/);
  });
});
