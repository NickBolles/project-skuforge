import type { PrismaClient } from "@prisma/client";
import type { CatalogVariant, ShopifyCatalog } from "../adapters/shopify/catalog";
import { parsePattern, render } from "../core/sku";
import { DupIndex } from "../core/validate";
import { peekSequence } from "./sequence.server";
import type { RuleConfig } from "./rules.server";

export interface PreviewRow {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  currentSku: string | null;
  proposedSku: string | null;
  collision: boolean;
  error?: string;
}

export interface RulePreview {
  rows: PreviewRow[];
  sampledCatalogSize: number;
  sequenceStart: number;
  sampleBased: true;
  writesPerformed: 0;
}

export function variantInScope(variant: CatalogVariant, config: RuleConfig): boolean {
  const scope = config.scope;
  const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
  if (scope.vendors.length && !scope.vendors.some((value) => same(value, variant.vendor))) return false;
  if (scope.productTypes.length && !scope.productTypes.some((value) => same(value, variant.productType))) return false;
  if (scope.tags.length && !scope.tags.some((tag) => variant.tags.some((value) => same(value, tag)))) return false;
  return true;
}

export async function previewRule(options: {
  db: Pick<PrismaClient, "sequenceCounter">;
  catalog: ShopifyCatalog;
  shopId: string;
  ruleId: string;
  pattern: string;
  config: RuleConfig;
  limit?: number;
}): Promise<RulePreview> {
  const parsed = parsePattern(options.pattern);
  if (!parsed.ok) throw new Error(`${parsed.errors[0]!.message} (position ${parsed.errors[0]!.position})`);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
  const page = await options.catalog.listVariantsPage({ pageSize: 250 });
  const sequenceStart = await peekSequence(options.db, options.shopId, `rule:${options.ruleId}`);
  const index = new DupIndex();
  index.addBatch(page.variants.map((variant) => ({ variantId: variant.variantId, sku: variant.sku })));
  const sample = page.variants.filter((variant) => variantInScope(variant, options.config)).slice(0, limit);
  const rows = sample.map((variant, offset): PreviewRow => {
    try {
      const proposedSku = render(
        parsed.ast,
        {
          vendor: variant.vendor,
          productType: variant.productType,
          productTitle: variant.productTitle,
          options: variant.options,
        },
        sequenceStart + offset,
        options.config,
      );
      const collision = index.has(proposedSku, variant.variantId);
      index.reserve(proposedSku, `@preview:${variant.variantId}`);
      return {
        variantId: variant.variantId,
        productTitle: variant.productTitle,
        variantTitle: variant.variantTitle,
        currentSku: variant.sku,
        proposedSku,
        collision,
      };
    } catch (error) {
      return {
        variantId: variant.variantId,
        productTitle: variant.productTitle,
        variantTitle: variant.variantTitle,
        currentSku: variant.sku,
        proposedSku: null,
        collision: false,
        error: error instanceof Error ? error.message : "Preview failed.",
      };
    }
  });
  return {
    rows,
    sampledCatalogSize: page.variants.length,
    sequenceStart,
    sampleBased: true,
    writesPerformed: 0,
  };
}
