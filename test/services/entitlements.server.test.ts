import { afterEach, describe, expect, it } from "vitest";
import { FakeBillingGateway } from "../../app/adapters/billing/fakeBilling";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { ENTITLEMENT_FEATURES, FREE_VARIANT_LIMIT, type BillingPlan } from "../../app/core/constants";
import { can, enforceVariantLimit, EntitlementError } from "../../app/services/entitlements.server";

function variants(count: number): CatalogVariant[] {
  return Array.from({ length: count }, (_, index) => ({
    productId: `p${index}`, variantId: `v${index}`, productTitle: "Product", variantTitle: "Default", vendor: "Acme", productType: "Item", tags: [], options: {}, sku: `SKU-${index}`, barcode: null, price: "1.00", status: "ACTIVE" as const, updatedAt: "2026-01-01T00:00:00Z",
  }));
}

describe("entitlement matrix", () => {
  afterEach(() => FakeBillingGateway.clearOverrides());

  it("matches the complete pricing truth table", () => {
    const truth: Record<BillingPlan, boolean[]> = {
      free: [true, false, false, false, false],
      pro: [true, true, true, false, false],
      premium: [true, true, true, true, true],
    };
    for (const [plan, expected] of Object.entries(truth) as Array<[BillingPlan, boolean[]]>) {
      expect(ENTITLEMENT_FEATURES.map((feature) => can(plan, feature))).toEqual(expected);
    }
  });

  it("allows exactly 50 free variants and rejects 51 with a clear reason", async () => {
    const billing = new FakeBillingGateway("free");
    await expect(enforceVariantLimit(billing, new InMemoryShopifyCatalog(variants(FREE_VARIANT_LIMIT)), "shop")).resolves.toBeUndefined();
    await expect(enforceVariantLimit(billing, new InMemoryShopifyCatalog(variants(FREE_VARIANT_LIMIT + 1)), "shop")).rejects.toMatchObject({
      name: "EntitlementError", feature: "variant_limit", requiredPlan: "pro",
    } satisfies Partial<EntitlementError>);
  });

  it("supports a dev-only fake plan switcher", async () => {
    const gateway = new FakeBillingGateway("free");
    expect(await gateway.getPlan("shop")).toBe("free");
    gateway.switchPlan("shop", "premium");
    expect(await gateway.getPlan("shop")).toBe("premium");
  });
});
