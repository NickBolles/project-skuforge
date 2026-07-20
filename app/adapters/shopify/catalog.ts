export interface CatalogVariant {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  vendor: string;
  productType: string;
  tags: string[];
  options: Record<string, string>;
  sku: string | null;
  barcode: string | null;
  price: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  updatedAt: string;
}

export interface VariantWrite {
  variantId: string;
  sku?: string;
  barcode?: string;
  expectedSku?: string | null;
  expectedBarcode?: string | null;
}

export interface WriteResult {
  variantId: string;
  status: "applied" | "skipped_conflict" | "error";
  message?: string;
}

export interface VariantPage {
  variants: CatalogVariant[];
  cursor: string | null;
  hasNext: boolean;
}

export interface ShopifyCatalog {
  streamAllVariants(opts?: { batchSize?: number }): AsyncIterable<CatalogVariant[]>;
  listVariantsPage(opts: {
    cursor?: string;
    pageSize: number;
    filter?: {
      text?: string;
      vendor?: string;
      productType?: string;
      missingSku?: boolean;
      missingBarcode?: boolean;
    };
  }): Promise<VariantPage>;
  findVariantsBySku(
    values: string[],
    field?: "sku" | "barcode",
  ): Promise<CatalogVariant[]>;
  getVariants(variantIds: string[]): Promise<CatalogVariant[]>;
  countVariants(): Promise<number>;
  updateVariants(writes: VariantWrite[]): Promise<WriteResult[]>;
}
