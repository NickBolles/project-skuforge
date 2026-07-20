import { canWriteBarcode, normalizeSku } from "../../core/validate";
import {
  CatalogError,
  type CatalogVariant,
  type ShopifyCatalog,
  type VariantFilter,
  type VariantPage,
  type VariantWrite,
  type WriteResult,
} from "./catalog";

export interface InMemorySimulation {
  throttleEveryN?: number;
  conflictVariantIds?: Iterable<string>;
  errorVariantIds?: Iterable<string>;
  mutateDuringStream?: (
    catalog: InMemoryShopifyCatalog,
    completedBatchIndex: number,
  ) => void | Promise<void>;
  bulkOpDelay?: number;
}

export interface InMemoryCatalogOptions {
  simulate?: InMemorySimulation;
  onProductWrite?: (productId: string, writes: readonly VariantWrite[]) => void;
}

function cloneVariant(variant: CatalogVariant): CatalogVariant {
  return {
    ...variant,
    tags: [...variant.tags],
    options: { ...variant.options },
  };
}

function validateBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError("batchSize must be a positive safe integer");
  }
}

function validatePageSize(pageSize: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 250) {
    throw new RangeError("pageSize must be an integer from 1 through 250");
  }
}

function isMissing(value: string | null): boolean {
  return value === null || value.trim() === "";
}

function same(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function matchesFilter(
  variant: CatalogVariant,
  filter: VariantFilter = {},
): boolean {
  if (filter.vendor && !same(variant.vendor, filter.vendor)) return false;
  if (filter.productType && !same(variant.productType, filter.productType))
    return false;
  if (filter.missingSku && !isMissing(variant.sku)) return false;
  if (filter.missingBarcode && !isMissing(variant.barcode)) return false;
  if (filter.text) {
    const needle = filter.text.trim().toLocaleLowerCase();
    const haystack = [
      variant.productTitle,
      variant.variantTitle,
      variant.vendor,
      variant.productType,
      variant.sku ?? "",
      variant.barcode ?? "",
      ...variant.tags,
      ...Object.values(variant.options),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class InMemoryShopifyCatalog implements ShopifyCatalog {
  private readonly variants: CatalogVariant[];
  private readonly conflicts: Set<string>;
  private readonly errors: Set<string>;
  private readonly options: InMemoryCatalogOptions;
  private bulkOperationActive = false;
  private productWriteOrdinal = 0;
  readonly throttleEvents: number[] = [];

  constructor(
    seed: readonly CatalogVariant[],
    options: InMemoryCatalogOptions = {},
  ) {
    this.variants = seed.map(cloneVariant);
    this.options = options;
    this.conflicts = new Set(options.simulate?.conflictVariantIds);
    this.errors = new Set(options.simulate?.errorVariantIds);
  }

  async *streamAllVariants(
    opts: { batchSize?: number } = {},
  ): AsyncIterable<CatalogVariant[]> {
    const batchSize = opts.batchSize ?? 250;
    validateBatchSize(batchSize);
    if (this.bulkOperationActive) {
      throw new CatalogError(
        "BULK_OP_ALREADY_RUNNING",
        "A bulk variant stream is already running for this catalog.",
      );
    }

    this.bulkOperationActive = true;
    try {
      await delay(this.options.simulate?.bulkOpDelay ?? 0);
      const snapshot = this.variants.map(cloneVariant);
      let batchIndex = 0;
      for (let offset = 0; offset < snapshot.length; offset += batchSize) {
        yield snapshot.slice(offset, offset + batchSize);
        await this.options.simulate?.mutateDuringStream?.(this, batchIndex);
        batchIndex += 1;
      }
    } finally {
      this.bulkOperationActive = false;
    }
  }

  async listVariantsPage(opts: {
    cursor?: string;
    pageSize: number;
    filter?: VariantFilter;
  }): Promise<VariantPage> {
    validatePageSize(opts.pageSize);
    let start = 0;
    if (opts.cursor !== undefined) {
      if (!opts.cursor.startsWith("memory:")) {
        throw new CatalogError(
          "INVALID_CURSOR",
          "The catalog cursor is invalid.",
        );
      }
      const variantId = decodeURIComponent(opts.cursor.slice("memory:".length));
      const cursorIndex = this.variants.findIndex(
        (variant) => variant.variantId === variantId,
      );
      if (cursorIndex < 0) {
        throw new CatalogError(
          "INVALID_CURSOR",
          "The catalog cursor no longer exists.",
        );
      }
      start = cursorIndex + 1;
    }

    const matching = this.variants
      .slice(start)
      .filter((variant) => matchesFilter(variant, opts.filter));
    const page = matching.slice(0, opts.pageSize);
    return {
      variants: page.map(cloneVariant),
      cursor:
        page.length === 0
          ? null
          : `memory:${encodeURIComponent(page[page.length - 1]!.variantId)}`,
      hasNext: matching.length > page.length,
    };
  }

  async findVariantsBySku(
    values: string[],
    field: "sku" | "barcode" = "sku",
  ): Promise<CatalogVariant[]> {
    const wanted = new Set(
      values
        .map((value) => normalizeSku(value))
        .filter((value) => value !== ""),
    );
    if (wanted.size === 0) return [];
    return this.variants
      .filter((variant) => {
        const value = variant[field];
        return value !== null && wanted.has(normalizeSku(value));
      })
      .map(cloneVariant);
  }

  async getVariants(variantIds: string[]): Promise<CatalogVariant[]> {
    const byId = new Map(
      this.variants.map((variant) => [variant.variantId, variant]),
    );
    return variantIds.flatMap((variantId) => {
      const variant = byId.get(variantId);
      return variant ? [cloneVariant(variant)] : [];
    });
  }

  async countVariants(): Promise<number> {
    return this.variants.length;
  }

  async updateVariants(writes: VariantWrite[]): Promise<WriteResult[]> {
    const positions = new Map(
      this.variants.map((variant, index) => [variant.variantId, index]),
    );
    const results = new Map<number, WriteResult>();
    const groups = new Map<
      string,
      Array<{ write: VariantWrite; inputIndex: number }>
    >();

    writes.forEach((write, inputIndex) => {
      const position = positions.get(write.variantId);
      if (position === undefined) {
        results.set(inputIndex, {
          variantId: write.variantId,
          status: "error",
          message: "Variant was not found.",
        });
        return;
      }
      const productId = this.variants[position]!.productId;
      const group = groups.get(productId) ?? [];
      group.push({ write, inputIndex });
      groups.set(productId, group);
    });

    for (const [productId, group] of groups) {
      this.productWriteOrdinal += 1;
      const throttleEveryN = this.options.simulate?.throttleEveryN;
      if (throttleEveryN && this.productWriteOrdinal % throttleEveryN === 0) {
        this.throttleEvents.push(this.productWriteOrdinal);
        await Promise.resolve();
      }
      this.options.onProductWrite?.(
        productId,
        group.map(({ write }) => write),
      );

      for (const { write, inputIndex } of group) {
        const position = positions.get(write.variantId)!;
        const current = this.variants[position]!;
        if (this.errors.has(write.variantId)) {
          results.set(inputIndex, {
            variantId: write.variantId,
            status: "error",
            message: "Simulated catalog write error.",
          });
          continue;
        }
        const skuConflict =
          this.conflicts.has(write.variantId) ||
          ("expectedSku" in write && current.sku !== write.expectedSku);
        const barcodeConflict =
          "expectedBarcode" in write &&
          current.barcode !== write.expectedBarcode;
        const barcodeBlocked =
          write.barcode !== undefined &&
          !canWriteBarcode(current.barcode, write.barcode, {
            allowOverwrite: write.allowBarcodeOverwrite,
          });
        if (skuConflict || barcodeConflict || barcodeBlocked) {
          results.set(inputIndex, {
            variantId: write.variantId,
            status: "skipped_conflict",
            message: barcodeBlocked
              ? "A non-empty barcode cannot be overwritten without explicit consent."
              : "The variant changed after it was read.",
          });
          continue;
        }

        this.variants[position] = {
          ...current,
          ...(write.sku === undefined ? {} : { sku: write.sku }),
          ...(write.barcode === undefined ? {} : { barcode: write.barcode }),
        };
        results.set(inputIndex, {
          variantId: write.variantId,
          status: "applied",
        });
      }
    }

    return writes.map(
      (write, index) =>
        results.get(index) ?? {
          variantId: write.variantId,
          status: "error",
          message: "Catalog write did not produce a result.",
        },
    );
  }

  mutateVariant(variantId: string, patch: Partial<CatalogVariant>): boolean {
    const position = this.variants.findIndex(
      (variant) => variant.variantId === variantId,
    );
    if (position < 0) return false;
    this.variants[position] = cloneVariant({
      ...this.variants[position]!,
      ...patch,
    });
    return true;
  }

  addVariant(variant: CatalogVariant): void {
    if (
      this.variants.some((existing) => existing.variantId === variant.variantId)
    ) {
      throw new Error(`Variant already exists: ${variant.variantId}`);
    }
    this.variants.push(cloneVariant(variant));
  }

  snapshot(): CatalogVariant[] {
    return this.variants.map(cloneVariant);
  }
}
