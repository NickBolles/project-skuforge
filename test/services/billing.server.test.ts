import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db from "../../app/db.server";
import { handleSubscriptionUpdate, planFromSubscription } from "../../app/services/billing.server";

const shopDomain = "phase11-billing.myshopify.test";

describe("billing subscription webhook", () => {
  beforeEach(async () => { await db.shop.deleteMany({ where: { shopDomain } }); });
  afterAll(async () => { await db.shop.deleteMany({ where: { shopDomain } }); await db.$disconnect(); });

  it("maps fixture-like subscription payloads and persists plan changes", async () => {
    expect(planFromSubscription({ status: "ACTIVE", name: "SKUForge Premium" })).toBe("premium");
    expect(planFromSubscription({ status: "CANCELLED", name: "SKUForge Premium" })).toBe("free");
    await expect(handleSubscriptionUpdate(db, shopDomain, { app_subscription: { status: "ACTIVE", name: "SKUForge Pro" } })).resolves.toBe("pro");
    expect((await db.shop.findUniqueOrThrow({ where: { shopDomain } })).plan).toBe("pro");
  });
});
