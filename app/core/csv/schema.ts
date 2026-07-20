export const CSV_COLUMNS = [
  "variant_id",
  "product_title",
  "variant_title",
  "vendor",
  "sku",
  "barcode",
] as const;

export const CSV_IMPORT_ROW_LIMIT = 20_000;

export interface CsvVariantRow {
  variant_id: string;
  product_title: string;
  variant_title: string;
  vendor: string;
  sku: string;
  barcode: string;
}

export interface CsvCatalogVariant {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  vendor: string;
  sku: string | null;
  barcode: string | null;
}

export type CsvIssueCode =
  | "missing_column"
  | "parse_error"
  | "row_limit"
  | "missing_variant_id"
  | "unknown_variant_id"
  | "non_string_value"
  | "malformed_sku"
  | "malformed_barcode"
  | "default_rule_mismatch"
  | "in_file_duplicate_sku"
  | "catalog_duplicate_sku"
  | "in_file_duplicate_barcode"
  | "catalog_duplicate_barcode"
  | "barcode_overwrite";

export interface CsvImportIssue {
  code: CsvIssueCode;
  severity: "warning" | "block";
  message: string;
  relatedVariantIds?: string[];
}

export type CsvRowVerdict = "apply" | "no-op" | "warn" | "block";

export interface CsvImportRowReport {
  rowNumber: number;
  row: CsvVariantRow;
  currentSku: string | null;
  currentBarcode: string | null;
  skuChanged: boolean;
  barcodeChanged: boolean;
  verdict: CsvRowVerdict;
  eligibleForApply: boolean;
  issues: CsvImportIssue[];
}

export interface CsvImportReport {
  rows: CsvImportRowReport[];
  globalIssues: CsvImportIssue[];
  counts: Record<CsvRowVerdict, number>;
  applyCount: number;
}
