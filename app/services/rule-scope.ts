import type { CatalogVariant } from "../adapters/shopify/catalog";
import type { RuleConfig } from "./rules.server";

export function variantInScope(variant: CatalogVariant, config: RuleConfig): boolean {
  const scope = config.scope;
  const same = (left: string, right: string) =>
    left.trim().toLowerCase() === right.trim().toLowerCase();

  if (scope.vendors.length && !scope.vendors.some((value) => same(value, variant.vendor))) {
    return false;
  }
  if (scope.productTypes.length && !scope.productTypes.some((value) => same(value, variant.productType))) {
    return false;
  }
  if (scope.tags.length && !scope.tags.some((tag) => variant.tags.some((value) => same(value, tag)))) {
    return false;
  }
  return true;
}
