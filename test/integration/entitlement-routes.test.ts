import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { FakeBillingGateway } from "../../app/adapters/billing/fakeBilling";
import { action as generateAction } from "../../app/routes/app.generate";
import { action as scanAction } from "../../app/routes/app.scan";
import { action as labelsAction } from "../../app/routes/api.labels.pdf";
import { action as csvAction } from "../../app/routes/app.csv";
import { loader as csvExportLoader } from "../../app/routes/api.csv.export";
import { action as autoWebhookAction } from "../../app/routes/api.dev.trigger-webhook";
import { action as productsWebhookAction } from "../../app/routes/webhooks.products-create";
import { action as billingAction } from "../../app/routes/app.billing";
import db from "../../app/db.server";
import { getMockCatalog } from "../../app/services/context.server";
import { createRule, ensureShop, parseRuleConfig } from "../../app/services/rules.server";
import { variantInScope } from "../../app/services/rule-scope";

const shop = "dev-shop.myshopify.test";

function args(request: Request) {
  return { request, params: {}, context: {} } as never;
}

async function expectForbidden(result: unknown, reason: RegExp) {
  expect(result).toBeInstanceOf(Response);
  const response = result as Response;
  expect(response.status).toBe(403);
  expect((await response.clone().json()).error).toMatch(reason);
}

describe("server-side entitlement call sites", () => {
  beforeEach(() => new FakeBillingGateway("premium").switchPlan(shop, "free"));
  afterEach(() => FakeBillingGateway.clearOverrides());

  it("blocks free-plan generation over 50 variants with a reason", async () => {
    const result = await generateAction(args(new Request("http://local/app/generate", {
      method: "POST",
      body: new FormData(),
    })));
    await expectForbidden(result, /up to 50 variants/i);
  });

  it("blocks interactive automation, duplicate scanning, labels, and both CSV directions", async () => {
    await expectForbidden(await autoWebhookAction(args(new Request("http://local/api/dev/trigger-webhook", { method: "POST", body: JSON.stringify({ variantIds: [] }), headers: { "content-type": "application/json" } }))), /requires the pro plan/i);
    await expectForbidden(await scanAction(args(new Request("http://local/app/scan", { method: "POST", body: new FormData() }))), /duplicate scanning requires the pro plan/i);
    await expectForbidden(await labelsAction(args(new Request("http://local/api/labels/pdf", { method: "POST", body: new FormData() }))), /label printing requires the premium plan/i);
    await expectForbidden(await csvAction(args(new Request("http://local/app/csv", { method: "POST", body: new FormData() }))), /CSV import and export requires the premium plan/i);
    await expectForbidden(await csvExportLoader(args(new Request("http://local/api/csv/export"))), /CSV import and export requires the premium plan/i);
  });

  it("200-acks and records a below-plan products/create delivery", async () => {
    const webhookId = `phase11-free-webhook-${globalThis.crypto.randomUUID()}`;
    const response = await productsWebhookAction(args(new Request("http://local/webhooks/products-create", {
      method: "POST",
      body: JSON.stringify({ variants: [] }),
      headers: { "content-type": "application/json", "x-shopify-webhook-id": webhookId },
    })));
    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toMatchObject({ ignored: true, reason: "plan" });
    await expect(db.webhookEvent.findUnique({ where: { id: webhookId } })).resolves.toMatchObject({ status: "ignored_plan" });
    await db.webhookEvent.delete({ where: { id: webhookId } });
  });

  it("registers products/create and routes a production delivery through generation with replay dedupe", async () => {
    const configText = await readFile(new URL("../../shopify.app.toml", import.meta.url), "utf8");
    expect(configText).toMatch(/topics\s*=\s*\[\s*["']products\/create["']\s*\]/);
    expect(configText).toMatch(/uri\s*=\s*["']\/webhooks\/products-create["']/);

    const catalog = getMockCatalog();
    const appShop = await ensureShop(db, shop);
    let createdRuleId: string | null = null;
    let defaultRule = await db.skuRuleSet.findFirst({ where: { shopId: appShop.id, isDefault: true, active: true } });
    if (!defaultRule) {
      defaultRule = await createRule(db, shop, {
        name: "Webhook route regression rule",
        pattern: "WH-{vendor:3}-{seq:4}",
        config: parseRuleConfig({}),
        isDefault: true,
      });
      createdRuleId = defaultRule.id;
    }
    const ruleConfig = parseRuleConfig(defaultRule.config);
    const target = catalog.snapshot().find((variant) => variantInScope(variant, ruleConfig));
    expect(target).toBeTruthy();
    const originalSku = target!.sku;
    catalog.mutateVariant(target!.variantId, { sku: null });
    await db.shop.update({ where: { id: appShop.id }, data: { settings: JSON.stringify({ autoGenerateOnCreate: true }) } });
    new FakeBillingGateway("free").switchPlan(shop, "pro");
    const webhookId = `production-products-create-${globalThis.crypto.randomUUID()}`;
    const request = () => new Request("http://local/webhooks/products-create", {
      method: "POST",
      body: JSON.stringify({ variantIds: [target!.variantId] }),
      headers: { "content-type": "application/json", "x-shopify-webhook-id": webhookId },
    });

    const first = await productsWebhookAction(args(request()));
    const replay = await productsWebhookAction(args(request()));
    expect([200, 202]).toContain(first.status);
    const firstBody = await first.json() as { jobId: string };
    expect(firstBody.jobId).toBeTruthy();
    await expect(replay.json()).resolves.toMatchObject({ deduped: true, jobId: null });
    expect(await db.generationJob.count({ where: { idempotencyKey: `wh:${webhookId}` } })).toBe(1);

    const job = await db.generationJob.findUniqueOrThrow({ where: { id: firstBody.jobId }, include: { items: true } });
    expect(job.items.map((item) => item.variantId)).toContain(target!.variantId);
    const verificationScanId = (JSON.parse(job.totals) as { verificationScanId?: string }).verificationScanId;
    if (verificationScanId) {
      await db.scanFinding.deleteMany({ where: { scanId: verificationScanId } });
      await db.duplicateScan.delete({ where: { id: verificationScanId } });
    }
    await db.generationJobItem.deleteMany({ where: { jobId: job.id } });
    await db.generationJob.delete({ where: { id: job.id } });
    await db.webhookEvent.delete({ where: { id: webhookId } });
    if (createdRuleId) await db.skuRuleSet.delete({ where: { id: createdRuleId } });
    catalog.mutateVariant(target!.variantId, { sku: originalSku });
  });

  it("switches the mock plan through the billing route", async () => {
    const form = new FormData();
    form.set("plan", "premium");
    const response = await billingAction(args(new Request("http://local/app/billing", { method: "POST", body: form })));
    expect(response.status).toBe(302);
    expect(await new FakeBillingGateway("free").getPlan(shop)).toBe("premium");
  });
});
