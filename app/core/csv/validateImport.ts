import { parsePattern } from "../sku";
import { evaluateBarcodeWrite, normalizeSku } from "../validate";
import type {
  CsvImportIssue,
  CsvImportReport,
  CsvImportRowReport,
  CsvCatalogVariant,
  CsvVariantRow,
} from "./schema";

export interface ValidateCsvImportOptions {
  includeBarcodeOverwrites?: boolean;
  defaultRulePattern?: string;
  globalIssues?: CsvImportIssue[];
}

function sameValue(left: string | null, right: string): boolean {
  return (left ?? "") === right;
}

function malformed(value: string): boolean {
  return value.length > 255 || Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || code === 127;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function skuPatternForRule(pattern: string): RegExp | undefined {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) return undefined;
  const source = parsed.ast.nodes.map((node) => {
    if (node.type === "literal") return escapeRegExp(node.value);
    if (node.kind === "seq") return node.padding ? `\\d{${node.padding},}` : "\\d+";
    if (node.limit) return `[\\p{L}\\p{N}]{1,${node.limit}}`;
    return "[\\p{L}\\p{N}]+";
  }).join("");
  return new RegExp(`^${source}$`, "u");
}

function issue(code: CsvImportIssue["code"], severity: CsvImportIssue["severity"], message: string, relatedVariantIds?: string[]): CsvImportIssue {
  return { code, severity, message, ...(relatedVariantIds?.length ? { relatedVariantIds } : {}) };
}

function addDuplicateIssues(
  rows: CsvImportRowReport[],
  field: "sku" | "barcode",
): void {
  const buckets = new Map<string, CsvImportRowReport[]>();
  for (const report of rows) {
    if (report.issues.some((entry) => entry.severity === "block")) continue;
    const value = report.row[field];
    const normalized = normalizeSku(value);
    if (!normalized) continue;
    const bucket = buckets.get(normalized) ?? [];
    bucket.push(report);
    buckets.set(normalized, bucket);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const ids = bucket.map((entry) => entry.row.variant_id);
    for (const report of bucket) {
      report.issues.push(issue(
        field === "sku" ? "in_file_duplicate_sku" : "in_file_duplicate_barcode",
        "block",
        `The CSV assigns the same ${field} to multiple variants.`,
        ids.filter((id) => id !== report.row.variant_id),
      ));
    }
  }
}

function addCatalogCollisions(
  rows: CsvImportRowReport[],
  catalog: readonly CsvCatalogVariant[],
  field: "sku" | "barcode",
  includeBarcodeOverwrites: boolean,
): void {
  const candidates = new Set(rows.filter((report) => {
    const changed = field === "sku" ? report.skuChanged : report.barcodeChanged;
    const blocked = report.issues.some((entry) => entry.severity === "block");
    const excludedOverwrite = field === "barcode" && report.issues.some((entry) => entry.code === "barcode_overwrite") && !includeBarcodeOverwrites;
    return changed && !blocked && !excludedOverwrite;
  }).map((report) => report.row.variant_id));

  for (;;) {
    const owners = new Map<string, string[]>();
    for (const variant of catalog) {
      if (candidates.has(variant.variantId)) continue;
      const normalized = normalizeSku(variant[field] ?? "");
      if (!normalized) continue;
      const bucket = owners.get(normalized) ?? [];
      bucket.push(variant.variantId);
      owners.set(normalized, bucket);
    }
    const collisions = rows.filter((report) => candidates.has(report.row.variant_id) && owners.has(normalizeSku(report.row[field])));
    if (collisions.length === 0) break;
    for (const report of collisions) candidates.delete(report.row.variant_id);
  }

  const finalOwners = new Map<string, string[]>();
  for (const variant of catalog) {
    if (candidates.has(variant.variantId)) continue;
    const normalized = normalizeSku(variant[field] ?? "");
    if (!normalized) continue;
    const bucket = finalOwners.get(normalized) ?? [];
    bucket.push(variant.variantId);
    finalOwners.set(normalized, bucket);
  }
  for (const report of rows) {
    const changed = field === "sku" ? report.skuChanged : report.barcodeChanged;
    if (!changed || report.issues.some((entry) => entry.severity === "block")) continue;
    const owners = finalOwners.get(normalizeSku(report.row[field]))?.filter((id) => id !== report.row.variant_id) ?? [];
    if (owners.length) {
      report.issues.push(issue(
        field === "sku" ? "catalog_duplicate_sku" : "catalog_duplicate_barcode",
        "block",
        `The proposed ${field} already exists in the catalog.`,
        owners,
      ));
    }
  }
}

export function validateCsvImport(
  imported: readonly CsvVariantRow[],
  catalog: readonly CsvCatalogVariant[],
  options: ValidateCsvImportOptions = {},
): CsvImportReport {
  const currentById = new Map(catalog.map((variant) => [variant.variantId, variant]));
  const defaultPattern = options.defaultRulePattern ? skuPatternForRule(options.defaultRulePattern) : undefined;
  const rows: CsvImportRowReport[] = imported.map((row, index) => {
    const current = currentById.get(row.variant_id);
    const issues: CsvImportIssue[] = [];
    if (!row.variant_id.trim()) issues.push(issue("missing_variant_id", "block", "variant_id is required."));
    else if (!current) issues.push(issue("unknown_variant_id", "block", "The variant does not exist in this catalog."));
    if (malformed(row.sku)) issues.push(issue("malformed_sku", "block", "SKU contains control characters or exceeds 255 characters."));
    if (malformed(row.barcode)) issues.push(issue("malformed_barcode", "block", "Barcode contains control characters or exceeds 255 characters."));
    if (row.sku && defaultPattern && !defaultPattern.test(row.sku)) {
      issues.push(issue("default_rule_mismatch", "warning", "SKU does not match the shape of the default rule."));
    }
    if (current && evaluateBarcodeWrite(current.barcode, row.barcode) === "blocked_overwrite") {
      issues.push(issue("barcode_overwrite", "warning", "This row would replace a non-empty barcode that may be an official UPC/EAN."));
    }
    return {
      rowNumber: index + 2,
      row,
      currentSku: current?.sku ?? null,
      currentBarcode: current?.barcode ?? null,
      skuChanged: current ? !sameValue(current.sku, row.sku) : false,
      barcodeChanged: current ? !sameValue(current.barcode, row.barcode) : false,
      verdict: "no-op",
      eligibleForApply: false,
      issues,
    };
  });

  addDuplicateIssues(rows, "sku");
  addDuplicateIssues(rows, "barcode");
  addCatalogCollisions(rows, catalog, "sku", Boolean(options.includeBarcodeOverwrites));
  addCatalogCollisions(rows, catalog, "barcode", Boolean(options.includeBarcodeOverwrites));

  for (const report of rows) {
    const blocked = report.issues.some((entry) => entry.severity === "block");
    const warned = report.issues.some((entry) => entry.severity === "warning");
    const changed = report.skuChanged || report.barcodeChanged;
    const overwriteExcluded = report.issues.some((entry) => entry.code === "barcode_overwrite") && !options.includeBarcodeOverwrites;
    report.verdict = blocked ? "block" : warned ? "warn" : changed ? "apply" : "no-op";
    report.eligibleForApply = changed && !blocked && !overwriteExcluded;
  }
  const counts = {
    apply: rows.filter((row) => row.verdict === "apply").length,
    "no-op": rows.filter((row) => row.verdict === "no-op").length,
    warn: rows.filter((row) => row.verdict === "warn").length,
    block: rows.filter((row) => row.verdict === "block").length,
  };
  return {
    rows,
    globalIssues: [...(options.globalIssues ?? [])],
    counts,
    applyCount: rows.filter((row) => row.eligibleForApply).length,
  };
}
