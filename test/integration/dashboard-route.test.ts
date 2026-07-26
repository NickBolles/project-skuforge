import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dashboard, deriveDashboard, formatScanTime, type DashboardData } from "../../app/routes/app._index";

const CLEAN_SUMMARY = {
  variantsScanned: 1204,
  duplicateGroups: 0,
  duplicateVariants: 0,
  duplicateBarcodeGroups: 0,
  duplicateBarcodeVariants: 0,
  malformed: 0,
  missingSku: 0,
  missingBarcode: 0,
};

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    shopDomain: "demo.myshopify.com",
    plan: "pro",
    variantCount: 1204,
    authMode: "mock",
    hasDefaultRule: true,
    features: { scan: true, labels: true, csv: true },
    scan: { summary: { ...CLEAN_SUMMARY }, finishedAt: new Date("2026-07-20T06:00:00Z") },
    ...overrides,
  };
}

describe("dashboard view model", () => {
  it("celebrates a clean scan with the 0-duplicate hero and a healthy next step", () => {
    const vm = deriveDashboard(makeData());
    expect(vm.hero.tone).toBe("success");
    expect(vm.hero.headline).toBe("0 duplicate SKUs");
    expect(vm.hero.subtext).toContain("1,204 variants");
    expect(vm.nextStep.title).toBe("Your catalog is healthy");
    expect(vm.nextStep.href).toBe("/app/editor");
    expect(vm.setupComplete).toBe(true);
  });

  it("asks for a rule before anything else", () => {
    const vm = deriveDashboard(makeData({ hasDefaultRule: false, scan: null }));
    expect(vm.nextStep.href).toBe("/app/rules");
    expect(vm.setupSteps[0]!.done).toBe(false);
    expect(vm.setupComplete).toBe(false);
    expect(vm.hero.headline).toBe("Scan required");
    expect(vm.stats.map((stat) => stat.value)).toEqual(["1,204", "—", "—", "—"]);
  });

  it("asks for the first scan once a rule exists", () => {
    const vm = deriveDashboard(makeData({ scan: null }));
    expect(vm.nextStep.href).toBe("/app/scan");
    expect(vm.nextStep.title).toBe("Run your first catalog scan");
  });

  it("prioritizes open findings over missing values", () => {
    const vm = deriveDashboard(makeData({
      scan: {
        summary: { ...CLEAN_SUMMARY, duplicateGroups: 2, duplicateBarcodeGroups: 1, malformed: 1, missingSku: 40 },
        finishedAt: new Date("2026-07-20T06:00:00Z"),
      },
    }));
    expect(vm.hero.tone).toBe("critical");
    expect(vm.hero.headline).toBe("4 issues need attention");
    expect(vm.nextStep.title).toBe("Review and fix 4 open findings");
    expect(vm.nextStep.href).toBe("/app/scan");
    expect(vm.setupSteps[2]!.done).toBe(false);
  });

  it("routes clean-but-incomplete catalogs to generation", () => {
    const skuVm = deriveDashboard(makeData({ scan: { summary: { ...CLEAN_SUMMARY, missingSku: 12, missingBarcode: 30 }, finishedAt: null } }));
    expect(skuVm.nextStep.title).toBe("Generate SKUs for 12 variants");
    expect(skuVm.nextStep.href).toBe("/app/generate");
    const barcodeVm = deriveDashboard(makeData({ scan: { summary: { ...CLEAN_SUMMARY, missingBarcode: 30 }, finishedAt: null } }));
    expect(barcodeVm.nextStep.title).toBe("Generate barcodes for 30 variants");
  });

  it("badges plan-gated quick actions without hiding them", () => {
    const vm = deriveDashboard(makeData({ plan: "free", features: { scan: false, labels: false, csv: false } }));
    const byTitle = Object.fromEntries(vm.quickActions.map((action) => [action.title, action]));
    expect(byTitle["Scan & fix duplicates"]!.badge).toBe("Pro plan");
    expect(byTitle["Print labels"]!.badge).toBe("Premium plan");
    expect(byTitle["Export CSV"]!.badge).toBe("Premium plan");
    expect(byTitle["Browse & edit SKUs"]!.badge).toBeUndefined();
    expect(vm.quickActions).toHaveLength(8);
    expect(vm.quickActions.every((action) => action.href.startsWith("/"))).toBe(true);
  });

  it("formats scan times deterministically in UTC", () => {
    expect(formatScanTime(new Date("2026-07-20T06:00:00Z"))).toBe("Jul 20, 2026, 06:00 UTC");
    expect(formatScanTime("2026-07-20T06:00:00Z")).toBe("Jul 20, 2026, 06:00 UTC");
    expect(formatScanTime(null)).toBe("recently");
  });
});

describe("dashboard rendering", () => {
  it("renders the guided mock dashboard with hero, setup guide, stats, and quick actions", () => {
    const html = renderToStaticMarkup(createElement(Dashboard, { data: makeData({ hasDefaultRule: false, scan: null }) }));
    expect(html).toContain("Scan required");
    expect(html).toContain("Recommended next step");
    expect(html).toContain("Create your SKU rule");
    expect(html).toContain("Get set up");
    expect(html).toContain("Quick actions");
    expect(html).toContain("Browse &amp; edit SKUs");
    expect(html).toContain("/app/editor");
    expect(html).toContain("/api/csv/export");
    expect(html).toContain("View plans and billing");
  });

  it("hides the setup guide once every step is complete", () => {
    const html = renderToStaticMarkup(createElement(Dashboard, { data: makeData() }));
    expect(html).toContain("0 duplicate SKUs");
    expect(html).not.toContain("Get set up");
    expect(html).toContain("Your catalog is healthy");
  });

  it("renders the embedded dashboard with Polaris banners and badges", () => {
    const html = renderToStaticMarkup(createElement(Dashboard, { data: makeData({ authMode: "embedded", plan: "free", features: { scan: false, labels: false, csv: false } }) }));
    expect(html).toContain("s-banner");
    expect(html).toContain("0 duplicate SKUs");
    expect(html).toContain("Pro plan");
    expect(html).toContain("Premium plan");
    expect(html).toContain("Quick actions");
  });
});
