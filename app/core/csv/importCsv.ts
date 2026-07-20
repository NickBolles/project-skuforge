import Papa from "papaparse";
import { CSV_IMPORT_ROW_LIMIT, type CsvImportIssue, type CsvVariantRow } from "./schema";

export interface ParsedCsvImport {
  rows: CsvVariantRow[];
  issues: CsvImportIssue[];
}

function emptyRow(source: Record<string, unknown>): CsvVariantRow {
  return {
    variant_id: typeof source.variant_id === "string" ? source.variant_id : "",
    product_title: typeof source.product_title === "string" ? source.product_title : "",
    variant_title: typeof source.variant_title === "string" ? source.variant_title : "",
    vendor: typeof source.vendor === "string" ? source.vendor : "",
    sku: typeof source.sku === "string" ? source.sku : "",
    barcode: typeof source.barcode === "string" ? source.barcode : "",
  };
}

export function parseImportCsv(source: string, rowLimit = CSV_IMPORT_ROW_LIMIT): ParsedCsvImport {
  const result = Papa.parse<Record<string, unknown>>(source.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transformHeader: (header) => header.trim().toLocaleLowerCase(),
  });
  const issues: CsvImportIssue[] = result.errors.map((error) => ({
    code: "parse_error",
    severity: "block",
    message: `CSV row ${(error.row ?? 0) + 2}: ${error.message}`,
  }));
  const fields = new Set(result.meta.fields ?? []);
  for (const required of ["variant_id", "sku", "barcode"] as const) {
    if (!fields.has(required)) {
      issues.push({ code: "missing_column", severity: "block", message: `Required column “${required}” is missing.` });
    }
  }
  if (result.data.length > rowLimit) {
    issues.push({ code: "row_limit", severity: "block", message: `CSV imports are limited to ${rowLimit.toLocaleString()} rows.` });
  }
  for (const [index, raw] of result.data.entries()) {
    if (Object.values(raw).some((value) => typeof value !== "string")) {
      issues.push({ code: "non_string_value", severity: "block", message: `CSV row ${index + 2} contains a non-string value.` });
    }
  }
  return { rows: result.data.slice(0, rowLimit).map(emptyRow), issues };
}
