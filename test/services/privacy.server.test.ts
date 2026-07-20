import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import dataRequestFixture from "../fixtures/webhooks/customers-data-request.json";
import customerRedactFixture from "../fixtures/webhooks/customers-redact.json";
import shopRedactFixture from "../fixtures/webhooks/shop-redact.json";
import db from "../../app/db.server";
import { cleanupUninstalledShop, purgeShopData, recordCustomerDataRequest, redactCustomerData } from "../../app/services/privacy.server";
import { verifyShopifyWebhookHmac } from "../../app/services/webhook-security.server";
import { createRule, ensureShop, parseRuleConfig } from "../../app/services/rules.server";
import { action as dataRequestAction } from "../../app/routes/webhooks.customers-data-request";

const shopDomain = "phase12-privacy.myshopify.test";

async function clean() {
  await purgeShopData(db, shopDomain);
}

describe("mandatory privacy and uninstall lifecycle", () => {
  beforeEach(clean);
  afterAll(async () => { await clean(); await db.$disconnect(); });

  it("rejects an invalid webhook HMAC and accepts the exact signed body", () => {
    const raw = JSON.stringify(dataRequestFixture);
    const valid = createHmac("sha256", "secret").update(raw).digest("base64");
    expect(verifyShopifyWebhookHmac(raw, "invalid", "secret")).toBe(false);
    expect(verifyShopifyWebhookHmac(`${raw} `, valid, "secret")).toBe(false);
    expect(verifyShopifyWebhookHmac(raw, valid, "secret")).toBe(true);
  });

  it("returns 401 from a mandatory webhook handler before processing a bad signature", async () => {
    vi.stubEnv("AUTH_MODE", "shopify");
    vi.stubEnv("SHOPIFY_API_KEY", "key");
    vi.stubEnv("SHOPIFY_API_SECRET", "secret");
    try {
      const response = await dataRequestAction({ request: new Request("http://local/webhooks/customers-data-request", {
        method: "POST",
        body: JSON.stringify(dataRequestFixture),
        headers: { "content-type": "application/json", "x-shopify-hmac-sha256": "invalid" },
      }), params: {}, context: {} } as never);
      expect(response.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("handles customer request/redaction fixtures without retaining customer PII", async () => {
    expect(dataRequestFixture.customer.email).toBeTruthy();
    expect(customerRedactFixture.customer.email).toBeTruthy();
    await recordCustomerDataRequest({ db, shopDomain, webhookId: "privacy-request-1" });
    await redactCustomerData({ db, shopDomain, webhookId: "privacy-redact-1" });
    const events = await db.webhookEvent.findMany({ where: { shop: { shopDomain } }, orderBy: { id: "asc" } });
    expect(events.map((event) => event.status)).toEqual(["completed_no_customer_data", "completed_no_customer_data"]);
    expect(events.every((event) => !event.payload.includes(dataRequestFixture.customer.email))).toBe(true);
  });

  it("marks uninstall, removes sessions/locks, cancels jobs, and disables rules", async () => {
    const shop = await ensureShop(db, shopDomain);
    await createRule(db, shopDomain, { name: "Default", pattern: "SKU-{seq:3}", config: parseRuleConfig({}), isDefault: true });
    await db.session.create({ data: { id: `offline_${shopDomain}`, shop: shopDomain, state: "state", isOnline: false, accessToken: "test" } });
    await db.generationJob.create({ data: { id: "privacy-job", shopId: shop.id, ruleSetId: "rule", trigger: "selected", fields: "[\"sku\"]", idempotencyKey: "privacy-job-key" } });
    await db.jobLock.create({ data: { shopId: shop.id, jobId: "privacy-job", kind: "generation" } });
    const result = await cleanupUninstalledShop(db, shopDomain);
    expect(result).toEqual({ sessionsDeleted: 1, locksDeleted: 1, jobsCancelled: 1 });
    expect((await db.shop.findUniqueOrThrow({ where: { shopDomain } })).uninstalledAt).not.toBeNull();
    expect(await db.skuRuleSet.count({ where: { shopId: shop.id, active: true } })).toBe(0);
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: "privacy-job" } })).status).toBe("cancelled");
  });

  it("purges all shop-owned records for the shop-redact fixture and is idempotent", async () => {
    expect(shopRedactFixture.shop_domain).toBe("privacy.myshopify.test");
    const shop = await ensureShop(db, shopDomain);
    await db.webhookEvent.create({ data: { id: "shop-redact-event", shopId: shop.id, topic: "TEST", payload: "{}" } });
    await expect(purgeShopData(db, shopDomain)).resolves.toEqual({ alreadyPurged: false });
    expect(await db.shop.findUnique({ where: { shopDomain } })).toBeNull();
    await expect(purgeShopData(db, shopDomain)).resolves.toEqual({ alreadyPurged: true });
  });
});
