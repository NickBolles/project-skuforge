import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import db from "../../app/db.server";
import { action as rulesAction, loader as rulesLoader, RulesPage } from "../../app/routes/app.rules";
import { loader as editorLoader, RuleEditorPage } from "../../app/routes/app.rules.$id";
import { parseRuleConfig } from "../../app/services/rules.server";
import type { RulePreview } from "../../app/services/preview.server";

const shopDomain = "dev-shop.myshopify.test";

async function resetRules() {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (shop) {
    await db.sequenceCounter.deleteMany({ where: { shopId: shop.id } });
    await db.skuRuleSet.deleteMany({ where: { shopId: shop.id } });
  }
}

describe("rule routes", () => {
  beforeEach(resetRules);
  afterAll(async () => { await resetRules(); await db.$disconnect(); });

  it("creates a rule through the mock-auth action and loads preview data", async () => {
    const form = new FormData();
    form.set("name", "Route rule");
    form.set("pattern", "{vendor:3}-{seq:4}");
    form.set("config", JSON.stringify(parseRuleConfig({})));
    const response = await rulesAction({ request: new Request("http://localhost/app/rules", { method: "POST", body: form }), params: {}, context: {} } as never);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    const list = await rulesLoader({ request: new Request("http://localhost/app/rules"), params: {}, context: {} } as never);
    expect(list.rules).toHaveLength(1);
    const loaded = await editorLoader({ request: new Request(`http://localhost/app/rules/${list.rules[0]!.id}`), params: { id: list.rules[0]!.id }, context: {} } as never);
    expect(loaded.preview.rows.length).toBeGreaterThan(0);
    expect(loaded.preview.writesPerformed).toBe(0);
  });

  it("renders the rule-builder and preview pages without a browser", () => {
    const preview: RulePreview = { rows: [{ variantId: "v1", productTitle: "Shirt", variantTitle: "Small", currentSku: null, proposedSku: "ACM-0001", collision: true }], sampledCatalogSize: 1, sequenceStart: 1, sampleBased: true, writesPerformed: 0 };
    const listHtml = renderToStaticMarkup(createElement(RulesPage, { rules: [] }));
    const editorHtml = renderToStaticMarkup(createElement(RuleEditorPage, { initial: { name: "Primary", pattern: "{vendor}-{seq:4}", config: parseRuleConfig({}), isDefault: true, active: true }, preview }));
    expect(listHtml).toContain("Create a rule");
    expect(editorHtml).toContain("Rule builder");
    expect(editorHtml).toContain("Preview — nothing written");
    expect(editorHtml).toContain("Collision — sample-based");
  });
});
