import { describe, expect, it } from "vitest";
import { FakeBillingGateway } from "../../app/adapters/billing/fakeBilling";
import { FixtureCatalog } from "../../app/adapters/shopify/fixture-catalog.server";
import { getAppContext } from "../../app/services/context.server";

describe("application context", () => {
  it("returns fixture-backed adapters with explicit mock auth and no credentials", async () => {
    const context = await getAppContext(new Request("http://localhost/app"), {
      NODE_ENV: "test",
      AUTH_MODE: "mock",
      MOCK_PLAN: "premium",
    });

    expect(context.authMode).toBe("mock");
    expect(context.session.shop).toBe("dev-shop.myshopify.test");
    expect(context.catalog).toBeInstanceOf(FixtureCatalog);
    expect(context.billing).toBeInstanceOf(FakeBillingGateway);
    await expect(context.catalog.countVariants()).resolves.toBe(120);
    await expect(context.billing.getPlan(context.session.shop)).resolves.toBe("premium");
  });
});
