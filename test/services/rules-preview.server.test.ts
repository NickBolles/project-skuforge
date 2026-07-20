import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "../../app/db.server";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import type { CatalogVariant } from "../../app/adapters/shopify/catalog";
import { createRule, deleteRule, listRules, parseRuleConfig, RuleValidationError, updateRule } from "../../app/services/rules.server";
import { peekSequence } from "../../app/services/sequence.server";
import { previewRule, variantInScope } from "../../app/services/preview.server";

const shopDomain = "phase4-rules.myshopify.test";
const config = parseRuleConfig({ casing: "upper", stripNonAlphanumeric: true, scope: { vendors: [], productTypes: [], tags: [] } });
const variants: CatalogVariant[] = [
  { productId: "p1", variantId: "v1", productTitle: "Alpha Shirt", variantTitle: "Small", vendor: "Acme", productType: "Shirts", tags: ["summer"], options: { Size: "S" }, sku: "ACM-SHI-S-0001", barcode: null, price: "10.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
  { productId: "p1", variantId: "v2", productTitle: "Alpha Shirt", variantTitle: "Medium", vendor: "Acme", productType: "Shirts", tags: ["summer"], options: { Size: "S" }, sku: null, barcode: null, price: "10.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
  { productId: "p2", variantId: "v3", productTitle: "Winter Hat", variantTitle: "One size", vendor: "Other", productType: "Hats", tags: ["winter"], options: {}, sku: "HAT-1", barcode: null, price: "8.00", status: "ACTIVE", updatedAt: "2026-01-01T00:00:00Z" },
];

async function resetShop() {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return;
  await db.sequenceCounter.deleteMany({ where: { shopId: shop.id } });
  await db.skuRuleSet.deleteMany({ where: { shopId: shop.id } });
  await db.shop.delete({ where: { id: shop.id } });
}

describe("rule management and preview services", () => {
  beforeEach(resetShop);
  afterAll(async () => { await resetShop(); await db.$disconnect(); });

  it("creates, lists, updates, and deletes valid rules", async () => {
    const created = await createRule(db, shopDomain, { name: "Primary", pattern: "{vendor:3}-{seq:4}", config, isDefault: true });
    expect((await listRules(db, shopDomain)).map((rule) => rule.id)).toEqual([created.id]);
    const updated = await updateRule(db, shopDomain, created.id, { name: "Updated", pattern: "{title:4}-{seq:3}", config, isDefault: true, active: false });
    expect(updated).toMatchObject({ name: "Updated", active: false });
    await deleteRule(db, shopDomain, created.id);
    expect(await listRules(db, shopDomain)).toEqual([]);
  });

  it("rejects positioned parse errors and a second default", async () => {
    await expect(createRule(db, shopDomain, { name: "Bad", pattern: "X-{wat}", config })).rejects.toMatchObject({ code: "INVALID_PATTERN", patternErrors: [{ position: 3 }] });
    await createRule(db, shopDomain, { name: "One", pattern: "{vendor}", config, isDefault: true });
    await expect(createRule(db, shopDomain, { name: "Two", pattern: "{title}", config, isDefault: true })).rejects.toBeInstanceOf(RuleValidationError);
  });

  it("peeks without creating or consuming sequence counters", async () => {
    const shop = await db.shop.upsert({ where: { shopDomain }, create: { shopDomain }, update: {} });
    await expect(peekSequence(db, shop.id, "rule:r1")).resolves.toBe(1);
    expect(await db.sequenceCounter.count({ where: { shopId: shop.id } })).toBe(0);
    await db.sequenceCounter.create({ data: { shopId: shop.id, key: "rule:r1", nextValue: 41 } });
    await expect(peekSequence(db, shop.id, "rule:r1")).resolves.toBe(41);
    await expect(peekSequence(db, shop.id, "rule:r1")).resolves.toBe(41);
  });

  it("uses interactive paging, scopes variants, badges sample collisions, and performs no writes", async () => {
    const shop = await db.shop.upsert({ where: { shopDomain }, create: { shopDomain }, update: {} });
    const catalog = new InMemoryShopifyCatalog(variants);
    const streamSpy = vi.spyOn(catalog, "streamAllVariants");
    const writeSpy = vi.spyOn(catalog, "updateVariants");
    const scoped = parseRuleConfig({ ...config, scope: { vendors: ["Acme"], productTypes: ["Shirts"], tags: ["summer"] } });
    const preview = await previewRule({ db, catalog, shopId: shop.id, ruleId: "r1", pattern: "{vendor:3}-{product-type:3}-{option:Size}-{seq:4}", config: scoped });
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({ proposedSku: "ACM-SHI-S-0001", collision: false });
    expect(preview.rows[1]).toMatchObject({ proposedSku: "ACM-SHI-S-0002", collision: false });
    expect(preview.writesPerformed).toBe(0);
    expect(streamSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(variantInScope(variants[2]!, scoped)).toBe(false);
  });

  it("badges collisions between preview proposals as sample-based", async () => {
    const shop = await db.shop.upsert({ where: { shopDomain }, create: { shopDomain }, update: {} });
    const catalog = new InMemoryShopifyCatalog(variants);
    const preview = await previewRule({ db, catalog, shopId: shop.id, ruleId: "r1", pattern: "FIXED", config });
    expect(preview.rows.slice(0, 2).map((row) => row.collision)).toEqual([false, true]);
    expect(preview.sampleBased).toBe(true);
  });
});
