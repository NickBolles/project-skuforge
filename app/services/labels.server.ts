import type { CatalogVariant, ShopifyCatalog } from "../adapters/shopify/catalog";
import {
  composeLabels,
  getLabelTemplate,
  type ComposeLabelOptions,
  type LabelItem,
} from "../core/labels";

export interface LabelPdfRequest extends ComposeLabelOptions {
  templateId: string;
  variantIds: string[];
}

function labelItem(variant: CatalogVariant): LabelItem {
  return {
    sku: variant.sku?.trim() || "NO-SKU",
    barcode: variant.barcode,
    productName: variant.variantTitle === "Default"
      ? variant.productTitle
      : `${variant.productTitle} - ${variant.variantTitle}`,
    price: variant.price ? `$${variant.price}` : null,
  };
}

export async function createLabelsPdf(
  catalog: ShopifyCatalog,
  request: LabelPdfRequest,
): Promise<Uint8Array> {
  const ids = [...new Set(request.variantIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("Select at least one variant to print.");
  const variants = await catalog.getVariants(ids);
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  const ordered = ids.map((id) => byId.get(id)).filter((variant): variant is CatalogVariant => variant !== undefined);
  if (ordered.length !== ids.length) throw new Error("One or more selected variants no longer exist.");
  return composeLabels(getLabelTemplate(request.templateId), ordered.map(labelItem), request);
}

