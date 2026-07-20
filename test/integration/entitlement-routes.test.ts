import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeBillingGateway } from "../../app/adapters/billing/fakeBilling";
import { action as generateAction } from "../../app/routes/app.generate";
import { action as scanAction } from "../../app/routes/app.scan";
import { action as labelsAction } from "../../app/routes/api.labels.pdf";
import { action as csvAction } from "../../app/routes/app.csv";
import { loader as csvExportLoader } from "../../app/routes/api.csv.export";
import { action as autoWebhookAction } from "../../app/routes/api.dev.trigger-webhook";
import { action as productsWebhookAction } from "../../app/routes/webhooks.products-create";
import { action as billingAction } from "../../app/routes/app.billing";

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

  it("blocks automatic product generation, duplicate scanning, labels, and both CSV directions", async () => {
    await expectForbidden(await autoWebhookAction(args(new Request("http://local/api/dev/trigger-webhook", { method: "POST", body: JSON.stringify({ variantIds: [] }), headers: { "content-type": "application/json" } }))), /requires the pro plan/i);
    await expectForbidden(await scanAction(args(new Request("http://local/app/scan", { method: "POST", body: new FormData() }))), /duplicate scanning requires the pro plan/i);
    await expectForbidden(await labelsAction(args(new Request("http://local/api/labels/pdf", { method: "POST", body: new FormData() }))), /label printing requires the premium plan/i);
    await expectForbidden(await csvAction(args(new Request("http://local/app/csv", { method: "POST", body: new FormData() }))), /CSV import and export requires the premium plan/i);
    await expectForbidden(await csvExportLoader(args(new Request("http://local/api/csv/export"))), /CSV import and export requires the premium plan/i);
    await expectForbidden(await productsWebhookAction(args(new Request("http://local/webhooks/products-create", { method: "POST", body: JSON.stringify({ variants: [] }), headers: { "content-type": "application/json", "x-shopify-webhook-id": "phase11-free-webhook" } }))), /requires the pro plan/i);
  });

  it("switches the mock plan through the billing route", async () => {
    const form = new FormData();
    form.set("plan", "premium");
    const response = await billingAction(args(new Request("http://local/app/billing", { method: "POST", body: form })));
    expect(response.status).toBe(302);
    expect(await new FakeBillingGateway("free").getPlan(shop)).toBe("premium");
  });
});
