import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { action, EditorPage, loader } from "../../app/routes/app.editor";

const variant: CatalogVariant = {
  productId: "p1", variantId: "v1", productTitle: "Trail Shirt", variantTitle: "Small", vendor: "Acme", productType: "Apparel", tags: [], options: {}, sku: "ACM-001", barcode: null, price: "24.00", status: "ACTIVE", updatedAt: "2026-07-20T00:00:00Z",
};

describe("bulk editor route", () => {
  it("render-smokes the Polaris streamed-window grid and selection actions", () => {
    const html = renderToStaticMarkup(createElement(EditorPage, { data: {
      variants: [variant], cursor: "memory:v1", hasNext: true, totalVariants: 10_000,
      duplicateScan: null, filters: {}, plan: "free" as const, rules: [{ id: "rule-1", name: "Default" }],
    } }));
    expect(html).toContain("<s-table");
    expect(html).toContain("Trail Shirt");
    expect(html).toContain("Generate for selected");
    expect(html).toContain("Print labels");
    expect(html).toContain("Next page");
  });

  it("loads a cursor window and returns duplicate warnings through the route action", async () => {
    const loaded = await loader({ request: new Request("http://localhost/app/editor?q=malformed"), params: {}, context: {} } as never);
    expect(loaded.variants.length).toBeGreaterThan(0);
    expect(loaded.variants.length).toBeLessThanOrEqual(50);
    const target = loaded.variants.find((item) => item.sku && item.sku !== "SEEDED-DUPLICATE-001")!;
    const form = new FormData();
    form.set("intent", "inline-edit");
    form.set("variantId", target.variantId);
    form.set("field", "sku");
    form.set("newValue", "SEEDED-DUPLICATE-001");
    form.set("expectedValue", target.sku ?? "");
    form.set("expectedWasNull", target.sku === null ? "true" : "false");
    const result = await action({ request: new Request("http://localhost/app/editor", { method: "POST", body: form }), params: {}, context: {} } as never);
    expect(result.status).toBe("warning");
    if (result.status === "warning") expect(result.duplicateVariantIds.length).toBeGreaterThan(0);
  });
});
