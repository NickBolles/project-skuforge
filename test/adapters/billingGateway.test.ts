import { describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/billing/subscription-create-success.json";
import { ShopifyBillingGateway } from "../../app/adapters/billing/shopifyBilling";

describe("Shopify billing gateway recorded fixture", () => {
  it("creates a current Shopify recurring app subscription behind the port", async () => {
    const request = vi.fn().mockResolvedValue(fixture);
    const gateway = new ShopifyBillingGateway({
      client: { request },
      getStoredPlan: async () => "free",
      appUrl: "https://app.example.test",
      testCharges: true,
    });
    await expect(gateway.requestUpgrade("shop.myshopify.com", "pro")).resolves.toBe("https://admin.shopify.com/store/example/charges/confirm-123");
    expect(request).toHaveBeenCalledWith(expect.stringContaining("appSubscriptionCreate"), expect.objectContaining({
      name: "SKUForge Pro", test: true,
      lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: 12, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } }],
    }));
  });
});
