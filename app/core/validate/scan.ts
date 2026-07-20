import { DupIndex } from "./dupIndex";
import type {
  ScannableVariant,
  ScanFinding,
  ScanOptions,
  ScanResult,
  ScanVariantRef,
} from "./types";

function reference(variant: ScannableVariant): ScanVariantRef {
  const title = [variant.productTitle, variant.variantTitle]
    .filter(Boolean)
    .join(" — ");
  return {
    variantId: variant.variantId,
    ...(variant.productId === undefined
      ? {}
      : { productId: variant.productId }),
    title,
    sku: variant.sku,
    barcode: variant.barcode,
  };
}

function isMissing(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function matches(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  return regex.test(value);
}

export async function scanCatalog(
  batches: AsyncIterable<readonly ScannableVariant[]>,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const skuIndex = new DupIndex(options.normalization);
  const barcodeIndex = new DupIndex(options.normalization);
  const variants = new Map<string, ScanVariantRef>();
  const immediateFindings: ScanFinding[] = [];
  let variantsScanned = 0;
  let malformed = 0;
  let missingSku = 0;
  let missingBarcode = 0;

  for await (const batch of batches) {
    for (const variant of batch) {
      variantsScanned += 1;
      const ref = reference(variant);
      variants.set(variant.variantId, ref);

      if (isMissing(variant.sku)) {
        missingSku += 1;
        immediateFindings.push({ kind: "missing_sku", variants: [ref] });
      } else {
        skuIndex.add({ variantId: variant.variantId, sku: variant.sku });
        if (options.skuPattern && !matches(options.skuPattern, variant.sku!)) {
          malformed += 1;
          immediateFindings.push({
            kind: "malformed",
            value: variant.sku!,
            variants: [ref],
          });
        }
      }

      if (isMissing(variant.barcode)) {
        missingBarcode += 1;
        immediateFindings.push({ kind: "missing_barcode", variants: [ref] });
      } else if (options.includeDuplicateBarcodes ?? true) {
        barcodeIndex.add({
          variantId: variant.variantId,
          sku: variant.barcode,
        });
      }
    }
  }

  const skuGroups = skuIndex.groups();
  const barcodeGroups =
    (options.includeDuplicateBarcodes ?? true) ? barcodeIndex.groups() : [];
  const duplicateFindings: ScanFinding[] = skuGroups.map((group) => ({
    kind: "duplicate",
    normalizedValue: group.normalizedSku,
    variants: group.variants.map((entry) => variants.get(entry.variantId)!),
  }));
  const barcodeFindings: ScanFinding[] = barcodeGroups.map((group) => ({
    kind: "duplicate_barcode",
    normalizedValue: group.normalizedSku,
    variants: group.variants.map((entry) => variants.get(entry.variantId)!),
  }));

  return {
    findings: [...duplicateFindings, ...barcodeFindings, ...immediateFindings],
    summary: {
      variantsScanned,
      duplicateGroups: skuGroups.length,
      duplicateVariants: skuGroups.reduce(
        (total, group) => total + group.variants.length,
        0,
      ),
      duplicateBarcodeGroups: barcodeGroups.length,
      duplicateBarcodeVariants: barcodeGroups.reduce(
        (total, group) => total + group.variants.length,
        0,
      ),
      malformed,
      missingSku,
      missingBarcode,
    },
  };
}
