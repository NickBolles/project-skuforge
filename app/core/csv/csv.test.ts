import { describe, expect, it } from "vitest";
import { exportVariantsCsv, parseImportCsv, validateCsvImport, type CsvCatalogVariant } from ".";

function variant(id: string, sku: string | null, barcode: string | null, title = `Product ${id}`): CsvCatalogVariant {
  return { variantId: id, productTitle: title, variantTitle: "Default", vendor: "Acme, Inc.", sku, barcode };
}

describe("CSV round trip", () => {
  it("round-trips BOM, quotes, commas, and embedded newlines without field drift", () => {
    const source = [
      variant("v1", "SKU,ONE", "001", "Quoted \"shirt\""),
      variant("v2", "SKU-TWO", null, "Two\nLines"),
    ];
    const csv = exportVariantsCsv(source);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const parsed = parseImportCsv(csv);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual(source.map((item) => ({
      variant_id: item.variantId,
      product_title: item.productTitle,
      variant_title: item.variantTitle,
      vendor: item.vendor,
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
    })));
    expect(validateCsvImport(parsed.rows, source).counts["no-op"]).toBe(2);
  });

  it("accepts reordered and extra named columns but blocks unknown variant IDs", () => {
    const csv = "sku,extra,variant_id,barcode\r\nNEW,ignored,missing,\r\n";
    const parsed = parseImportCsv(csv);
    expect(parsed.issues).toEqual([]);
    const report = validateCsvImport(parsed.rows, [variant("v1", "OLD", null)]);
    expect(report.rows[0]!.issues.map((issue) => issue.code)).toContain("unknown_variant_id");
    expect(report.counts.block).toBe(1);
  });

  it("excludes non-empty barcode overwrites until explicit consent is supplied", () => {
    const catalog = [variant("v1", "SKU", "OFFICIAL-UPC")];
    const rows = [{ variant_id: "v1", product_title: "", variant_title: "", vendor: "", sku: "SKU", barcode: "INTERNAL" }];
    const guarded = validateCsvImport(rows, catalog);
    expect(guarded.rows[0]).toMatchObject({ verdict: "warn", eligibleForApply: false });
    expect(guarded.rows[0]!.issues.map((issue) => issue.code)).toContain("barcode_overwrite");
    const confirmed = validateCsvImport(rows, catalog, { includeBarcodeOverwrites: true });
    expect(confirmed.rows[0]).toMatchObject({ verdict: "warn", eligibleForApply: true });
  });
});
