import type {
  CatalogVariant,
  ShopifyCatalog,
  VariantPage,
  WriteResult,
} from "./catalog";

const unsupported = (): never => {
  throw new Error("This catalog operation is introduced in Phase 3.");
};

/** Phase-0 fixture adapter. Phase 3 replaces this with the contract-tested in-memory adapter. */
export class FixtureCatalog implements ShopifyCatalog {
  constructor(private readonly variants: readonly CatalogVariant[]) {}

  streamAllVariants(): AsyncIterable<CatalogVariant[]> {
    return unsupported();
  }

  async listVariantsPage(): Promise<VariantPage> {
    return unsupported();
  }

  async findVariantsBySku(): Promise<CatalogVariant[]> {
    return unsupported();
  }

  async getVariants(): Promise<CatalogVariant[]> {
    return unsupported();
  }

  async countVariants(): Promise<number> {
    return this.variants.length;
  }

  async updateVariants(): Promise<WriteResult[]> {
    return unsupported();
  }
}
