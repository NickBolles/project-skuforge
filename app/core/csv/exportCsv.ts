import Papa from "papaparse";
import { CSV_COLUMNS, type CsvCatalogVariant, type CsvVariantRow } from "./schema";

export function variantToCsvRow(variant: CsvCatalogVariant): CsvVariantRow {
  return {
    variant_id: variant.variantId,
    product_title: variant.productTitle,
    variant_title: variant.variantTitle,
    vendor: variant.vendor,
    sku: variant.sku ?? "",
    barcode: variant.barcode ?? "",
  };
}

export function exportCsvChunk(
  variants: readonly CsvCatalogVariant[],
  options: { header?: boolean; bom?: boolean } = {},
): string {
  if (variants.length === 0) {
    return options.header === false
      ? ""
      : `${options.bom ? "\uFEFF" : ""}${CSV_COLUMNS.join(",")}\r\n`;
  }
  const csv = Papa.unparse(variants.map(variantToCsvRow), {
    columns: [...CSV_COLUMNS],
    header: options.header ?? true,
    newline: "\r\n",
  });
  return `${options.bom ? "\uFEFF" : ""}${csv}${variants.length ? "\r\n" : ""}`;
}

export function exportVariantsCsv(variants: readonly CsvCatalogVariant[]): string {
  return exportCsvChunk(variants, { header: true, bom: true });
}
