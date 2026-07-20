import { describe, expect, it } from "vitest";

import {
  generateCatalog,
  fixtureQuotas,
} from "../../../test/fixtures/gen-catalog";
import {
  DupIndex,
  UniqueAssignmentError,
  assignUnique,
  canWriteBarcode,
  evaluateBarcodeWrite,
  normalizeSku,
  scanCatalog,
  type ScannableVariant,
} from ".";
import { parsePattern, patternToRegex } from "../sku";

async function* batches<T>(
  values: readonly T[],
  size: number,
): AsyncIterable<readonly T[]> {
  for (let index = 0; index < values.length; index += size) {
    yield values.slice(index, index + size);
  }
}

describe("normalizeSku", () => {
  it("trims, canonicalizes Unicode, and uppercases by default", () => {
    expect(normalizeSku("  café\u0301-1  ")).toBe("CAFÉ́-1".normalize("NFC"));
    expect(normalizeSku("  AbC  ", { trim: false, casing: "lower" })).toBe(
      "  abc  ",
    );
    expect(normalizeSku("AbC", { casing: "asis", unicodeForm: false })).toBe(
      "AbC",
    );
  });
});

describe("DupIndex", () => {
  it("groups normalized duplicates while preserving originals", async () => {
    const index = await DupIndex.from(
      batches(
        [
          { variantId: "v1", sku: " abc " },
          { variantId: "v2", sku: "ABC" },
          { variantId: "v3", sku: "Abc" },
          { variantId: "v4", sku: null },
        ],
        1,
      ),
    );
    expect(index.size).toBe(3);
    expect(index.has(" aBc ")).toBe(true);
    expect(index.groups()).toEqual([
      {
        normalizedSku: "ABC",
        variants: [
          { variantId: "v1", sku: " abc ", normalizedSku: "ABC" },
          { variantId: "v2", sku: "ABC", normalizedSku: "ABC" },
          { variantId: "v3", sku: "Abc", normalizedSku: "ABC" },
        ],
      },
    ]);
  });

  it("replaces a variant's old value and supports owner exclusions", () => {
    const index = new DupIndex();
    index.add({ variantId: "v1", sku: "OLD" });
    index.add({ variantId: "v1", sku: "NEW" });
    expect(index.has("OLD")).toBe(false);
    expect(index.has("NEW", "v1")).toBe(false);
    index.add({ variantId: "v2", sku: "new" });
    expect(index.has("NEW", "v1")).toBe(true);
  });
});

describe("scanCatalog", () => {
  it("finds SKU/barcode duplicates, malformed values, and missing fields", async () => {
    const variants: ScannableVariant[] = [
      { variantId: "v1", productId: "p1", sku: " SKU-001 ", barcode: "100" },
      { variantId: "v2", productId: "p1", sku: "sku-001", barcode: " 100 " },
      { variantId: "v3", productId: "p2", sku: "bad value", barcode: null },
      { variantId: "v4", productId: "p2", sku: "  ", barcode: "200" },
    ];
    const result = await scanCatalog(batches(variants, 2), {
      skuPattern: /^SKU-\d{3}$/,
    });
    expect(result.summary).toEqual({
      variantsScanned: 4,
      duplicateGroups: 1,
      duplicateVariants: 2,
      duplicateBarcodeGroups: 1,
      duplicateBarcodeVariants: 2,
      malformed: 3,
      missingSku: 1,
      missingBarcode: 1,
    });
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "duplicate",
      "duplicate_barcode",
      "malformed",
      "malformed",
      "malformed",
      "missing_barcode",
      "missing_sku",
    ]);
  });

  it("uses Phase 1 pattern regexes", async () => {
    const parsed = parsePattern("SKU-{vendor:3}-{seq:4}");
    if (!parsed.ok) throw new Error("pattern did not parse");
    const regex = patternToRegex(parsed.ast, {
      stripNonAlphanumeric: true,
      casing: "upper",
      missingValuePolicy: "error",
    });
    const result = await scanCatalog(
      batches(
        [
          { variantId: "v1", sku: "SKU-ACM-0001", barcode: "1" },
          { variantId: "v2", sku: "WRONG-ACM-0001", barcode: "2" },
        ],
        1,
      ),
      { skuPattern: regex },
    );
    expect(result.summary.malformed).toBe(1);
  });

  it("scans the deterministic 10k fixture with exact quotas under two seconds", async () => {
    const catalog = generateCatalog({ variants: 10_000 });
    const quotas = fixtureQuotas(10_000);
    const started = performance.now();
    const result = await scanCatalog(batches(catalog, 137), {
      skuPattern: /^(?:SKU-[A-Z]{3}-\d{6}|SEEDED-DUPLICATE-001)$/,
    });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.summary).toMatchObject({
      variantsScanned: 10_000,
      duplicateGroups: 1,
      duplicateVariants: quotas.duplicateVariants,
      malformed: quotas.malformedSku,
      missingSku: quotas.missingSku,
      missingBarcode: quotas.missingBarcode,
    });
  });
});

describe("assignUnique", () => {
  it("reserves clean proposals so later proposals collide", () => {
    const index = new DupIndex();
    expect(assignUnique("SKU-1", index)).toMatchObject({
      sku: "SKU-1",
      collisionsResolved: 0,
      resolution: "none",
    });
    expect(assignUnique(" sku-1 ", index)).toMatchObject({
      sku: " sku-1 -2",
      collisionsResolved: 1,
      resolution: "suffix",
    });
  });

  it("survives adversarial sequence and suffix collision chains", () => {
    const index = new DupIndex();
    ["SKU-0001", "SKU-0002", "SKU-0003", "SKU-0004-2", "SKU-0004-3"].forEach(
      (sku, ordinal) => index.add({ variantId: `existing-${ordinal}`, sku }),
    );
    const result = assignUnique("SKU-0001", index, {
      type: "sequence",
      nextSequence: 2,
      maxSequenceAttempts: 2,
      render: (sequence) => `SKU-${sequence.toString().padStart(4, "0")}`,
      maxSuffixAttempts: 5,
    });
    expect(result).toMatchObject({
      sku: "SKU-0001-2",
      collisionsResolved: 3,
      resolution: "suffix",
    });
    expect(index.has(result.sku)).toBe(true);
  });

  it("uses a later sequence before suffix fallback", () => {
    const index = new DupIndex();
    index.addBatch([
      { variantId: "v1", sku: "P-1" },
      { variantId: "v2", sku: "P-2" },
    ]);
    expect(
      assignUnique("P-1", index, {
        type: "sequence",
        nextSequence: 2,
        render: (sequence) => `P-${sequence}`,
      }),
    ).toMatchObject({ sku: "P-3", sequence: 3, collisionsResolved: 2 });
  });

  it("fails closed when every bounded candidate collides", () => {
    const index = new DupIndex();
    index.addBatch([
      { variantId: "v1", sku: "A" },
      { variantId: "v2", sku: "A-2" },
    ]);
    expect(() => assignUnique("A", index, { maxSuffixAttempts: 1 })).toThrow(
      UniqueAssignmentError,
    );
    expect(() => assignUnique(" ", index)).toThrow(UniqueAssignmentError);
  });

  it("produces 5k normalized-unique values from adversarial seeded proposals", () => {
    let state = 0x51f15e;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const index = new DupIndex();
    for (let ordinal = 0; ordinal < 31; ordinal += 1) {
      index.add({ variantId: `existing-${ordinal}`, sku: `BASE-${ordinal}` });
    }
    const assigned = new Set<string>();
    for (let ordinal = 0; ordinal < 5_000; ordinal += 1) {
      const base = `BASE-${Math.floor(random() * 73)}`;
      const result = assignUnique(base, index, { maxSuffixAttempts: 6_000 });
      expect(assigned.has(result.normalizedSku)).toBe(false);
      assigned.add(result.normalizedSku);
    }
    expect(assigned.size).toBe(5_000);
    expect(index.groups()).toEqual([]);
  });
});

describe("barcode overwrite policy", () => {
  it.each([
    [null, "123", false, "allowed_empty", true],
    ["", "123", false, "allowed_empty", true],
    ["123", "123", false, "no_change", true],
    ["123", "456", false, "blocked_overwrite", false],
    ["123", "456", true, "allowed_overwrite", true],
    ["123", null, false, "blocked_overwrite", false],
  ] as const)(
    "current %s proposed %s allow=%s",
    (current, proposed, allowOverwrite, decision, allowed) => {
      expect(evaluateBarcodeWrite(current, proposed, { allowOverwrite })).toBe(
        decision,
      );
      expect(canWriteBarcode(current, proposed, { allowOverwrite })).toBe(
        allowed,
      );
    },
  );
});
