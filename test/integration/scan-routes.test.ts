import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { authorizedCronRequest, handleCronScan } from "../../app/services/cron.server";
import { Dashboard } from "../../app/routes/app._index";
import { ScanPage } from "../../app/routes/app.scan";

describe("scan routes", () => {
  it("render-smokes the real-scan hero and finding actions", () => {
    const finishedAt = new Date("2026-07-20T06:00:00Z");
    const scan = {
      id: "scan-1", shopId: "shop-1", trigger: "manual", status: "completed", totals: "{}", startedAt: finishedAt, finishedAt,
      summary: { variantsScanned: 3, duplicateGroups: 1, duplicateVariants: 2, duplicateBarcodeGroups: 0, duplicateBarcodeVariants: 0, malformed: 0, missingSku: 0, missingBarcode: 3 },
      findings: [{ id: "finding-1", scanId: "scan-1", kind: "duplicate", skuValue: "DUP", resolution: "open", resolvedAt: null, variants: [
        { variantId: "v1", title: "One", sku: "DUP", barcode: null },
        { variantId: "v2", title: "Two", sku: "DUP", barcode: null },
      ] }],
    };
    const scanHtml = renderToStaticMarkup(createElement(ScanPage, { data: { scan, defaultRule: { id: "rule-1", name: "Default" }, plan: "pro", canScan: true } as never }));
    expect(scanHtml).toContain("1 duplicate SKU groups");
    expect(scanHtml).toContain("Preview fix with default rule");
    expect(scanHtml).toContain("Ignore");
    const dashboardHtml = renderToStaticMarkup(createElement(Dashboard, { data: {
      shopDomain: "shop", plan: "pro", variantCount: 3, authMode: "mock",
      hasDefaultRule: true,
      features: { scan: true, labels: false, csv: false },
      scan: { summary: { ...scan.summary, duplicateGroups: 0 }, finishedAt },
    } }));
    expect(dashboardHtml).toContain("0 duplicate SKUs");
  });

  it("requires an exact bearer cron secret", () => {
    expect(authorizedCronRequest(new Request("http://local/api/cron/scan"), "secret")).toBe(false);
    expect(authorizedCronRequest(new Request("http://local/api/cron/scan", { headers: { authorization: "Bearer wrong" } }), "secret")).toBe(false);
    expect(authorizedCronRequest(new Request("http://local/api/cron/scan", { headers: { authorization: "Bearer secret" } }), "secret")).toBe(true);
  });

  it("returns 401 before invoking nightly scans when authorization is missing", async () => {
    let called = false;
    const response = await handleCronScan(new Request("http://local/api/cron/scan", { method: "POST" }), {
      secret: "secret",
      run: async () => { called = true; return []; },
    });
    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });
});
