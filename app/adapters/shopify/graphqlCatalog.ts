import { canWriteBarcode, normalizeSku } from "../../core/validate";
import {
  startAndWaitForBulkVariants,
  streamBulkVariantsFromUrl,
  type BulkLifecycleOptions,
} from "./bulkOperation";
import {
  CatalogError,
  type CatalogVariant,
  type ShopifyCatalog,
  type VariantFilter,
  type VariantPage,
  type VariantWrite,
  type WriteResult,
} from "./catalog";
import {
  ThrottledGraphqlClient,
  type ThrottledGraphqlClientOptions,
} from "./throttle";

const VARIANT_FIELDS = `
  id title sku barcode price updatedAt
  selectedOptions { name value }
  product { id title vendor productType tags status updatedAt }
`;

const LIST_VARIANTS = `#graphql
  query SKUForgeListVariants($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query, sortKey: ID) {
      edges { cursor node { ${VARIANT_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const FIND_VARIANTS = `#graphql
  query SKUForgeFindVariants($first: Int!, $after: String, $query: String!) {
    productVariants(first: $first, after: $after, query: $query, sortKey: ID) {
      edges { cursor node { ${VARIANT_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GET_VARIANTS = `#graphql
  query SKUForgeGetVariants($ids: [ID!]!) {
    nodes(ids: $ids) { ... on ProductVariant { ${VARIANT_FIELDS} } }
  }
`;

const COUNT_VARIANTS = `#graphql
  query SKUForgeCountVariants { productVariantsCount { count } }
`;

const UPDATE_VARIANTS = `#graphql
  mutation SKUForgeUpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

interface GraphqlProduct {
  id: string;
  title?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: CatalogVariant["status"];
  updatedAt?: string;
}

interface GraphqlVariant {
  id: string;
  title?: string;
  sku?: string | null;
  barcode?: string | null;
  price?: string;
  updatedAt?: string;
  selectedOptions?: Array<{ name: string; value: string }>;
  product: GraphqlProduct;
}

interface VariantConnection {
  edges: Array<{ cursor: string; node: GraphqlVariant }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface MutationUserError {
  field?: string[] | null;
  message: string;
}

export interface GraphqlShopifyCatalogOptions
  extends ThrottledGraphqlClientOptions, BulkLifecycleOptions {
  endpoint?: string;
  apiVersion?: string;
}

function toCatalogVariant(node: GraphqlVariant): CatalogVariant {
  return {
    productId: node.product.id,
    variantId: node.id,
    productTitle: node.product.title ?? "",
    variantTitle: node.title ?? "",
    vendor: node.product.vendor ?? "",
    productType: node.product.productType ?? "",
    tags: [...(node.product.tags ?? [])],
    options: Object.fromEntries(
      (node.selectedOptions ?? []).map((option) => [option.name, option.value]),
    ),
    sku: node.sku ?? null,
    barcode: node.barcode ?? null,
    price: node.price ?? "0.00",
    status: node.product.status ?? "ACTIVE",
    updatedAt:
      node.updatedAt ?? node.product.updatedAt ?? new Date(0).toISOString(),
  };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function variantFilterToSearch(
  filter: VariantFilter = {},
): string | null {
  const terms: string[] = [];
  if (filter.text?.trim()) terms.push(filter.text.trim());
  if (filter.vendor?.trim())
    terms.push(`vendor:${quoted(filter.vendor.trim())}`);
  if (filter.productType?.trim()) {
    terms.push(`product_type:${quoted(filter.productType.trim())}`);
  }
  if (filter.missingSku) terms.push("-sku:*");
  if (filter.missingBarcode) terms.push("-barcode:*");
  return terms.length === 0 ? null : terms.join(" AND ");
}

function validatePageSize(pageSize: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 250) {
    throw new RangeError("pageSize must be an integer from 1 through 250");
  }
}

export class GraphqlShopifyCatalog implements ShopifyCatalog {
  private readonly client: ThrottledGraphqlClient;
  private readonly bulkOptions: BulkLifecycleOptions;
  private bulkOperationActive = false;

  constructor(
    shopDomain: string,
    accessToken: string,
    options: GraphqlShopifyCatalogOptions = {},
  ) {
    const endpoint =
      options.endpoint ??
      `https://${shopDomain}/admin/api/${options.apiVersion ?? "2025-10"}/graphql.json`;
    this.client = new ThrottledGraphqlClient(endpoint, accessToken, options);
    this.bulkOptions = {
      pollIntervalMs: options.pollIntervalMs,
      timeoutMs: options.timeoutMs,
      sleep: options.sleep,
      now: options.now,
    };
  }

  async *streamAllVariants(
    opts: { batchSize?: number } = {},
  ): AsyncIterable<CatalogVariant[]> {
    const batchSize = opts.batchSize ?? 250;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
      throw new RangeError("batchSize must be a positive safe integer");
    }
    if (this.bulkOperationActive) {
      throw new CatalogError(
        "BULK_OP_ALREADY_RUNNING",
        "A bulk variant stream is already running for this catalog.",
      );
    }
    this.bulkOperationActive = true;
    try {
      const resultUrl = await startAndWaitForBulkVariants(
        this.client,
        this.bulkOptions,
      );
      let batch: CatalogVariant[] = [];
      for await (const variant of streamBulkVariantsFromUrl(
        this.client.rawFetch,
        resultUrl,
      )) {
        batch.push(variant);
        if (batch.length === batchSize) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length > 0) yield batch;
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
    const data = await this.client.request<{
      productVariants: VariantConnection;
    }>(
      LIST_VARIANTS,
      {
        first: opts.pageSize,
        after: opts.cursor ?? null,
        query: variantFilterToSearch(opts.filter),
      },
      20,
    );
    return {
      variants: data.productVariants.edges.map((edge) =>
        toCatalogVariant(edge.node),
      ),
      cursor: data.productVariants.pageInfo.endCursor,
      hasNext: data.productVariants.pageInfo.hasNextPage,
    };
  }

  async findVariantsBySku(
    values: string[],
    field: "sku" | "barcode" = "sku",
  ): Promise<CatalogVariant[]> {
    const normalizedValues = [
      ...new Set(values.map((value) => normalizeSku(value))),
    ].filter(Boolean);
    const wanted = new Set(normalizedValues);
    const found = new Map<string, CatalogVariant>();
    for (const valueChunk of chunks(normalizedValues, 40)) {
      const query = valueChunk
        .map((value) => `${field}:${quoted(value)}`)
        .join(" OR ");
      let after: string | null = null;
      do {
        const data: { productVariants: VariantConnection } =
          await this.client.request<{
            productVariants: VariantConnection;
          }>(FIND_VARIANTS, { first: 250, after, query }, 20);
        for (const edge of data.productVariants.edges) {
          const variant = toCatalogVariant(edge.node);
          const candidate = variant[field];
          if (candidate !== null && wanted.has(normalizeSku(candidate))) {
            found.set(variant.variantId, variant);
          }
        }
        after = data.productVariants.pageInfo.hasNextPage
          ? data.productVariants.pageInfo.endCursor
          : null;
      } while (after);
    }
    return [...found.values()];
  }

  async getVariants(variantIds: string[]): Promise<CatalogVariant[]> {
    if (variantIds.length === 0) return [];
    const found = new Map<string, CatalogVariant>();
    for (const idChunk of chunks([...new Set(variantIds)], 250)) {
      const data = await this.client.request<{
        nodes: Array<GraphqlVariant | null>;
      }>(GET_VARIANTS, { ids: idChunk }, Math.max(10, idChunk.length));
      for (const node of data.nodes)
        if (node?.product) found.set(node.id, toCatalogVariant(node));
    }
    return variantIds.flatMap((variantId) => {
      const variant = found.get(variantId);
      return variant ? [variant] : [];
    });
  }

  async countVariants(): Promise<number> {
    const data = await this.client.request<{
      productVariantsCount: { count: number };
    }>(COUNT_VARIANTS, {}, 2);
    return data.productVariantsCount.count;
  }

  async updateVariants(writes: VariantWrite[]): Promise<WriteResult[]> {
    if (writes.length === 0) return [];
    const initial = await this.getVariants(
      writes.map((write) => write.variantId),
    );
    const initialById = new Map(
      initial.map((variant) => [variant.variantId, variant]),
    );
    const results = new Map<number, WriteResult>();
    const productGroups = new Map<
      string,
      Array<{ write: VariantWrite; inputIndex: number }>
    >();

    writes.forEach((write, inputIndex) => {
      const variant = initialById.get(write.variantId);
      if (!variant) {
        results.set(inputIndex, {
          variantId: write.variantId,
          status: "error",
          message: "Variant was not found.",
        });
        return;
      }
      const group = productGroups.get(variant.productId) ?? [];
      group.push({ write, inputIndex });
      productGroups.set(variant.productId, group);
    });

    for (const [productId, productWrites] of productGroups) {
      for (const productChunk of chunks(productWrites, 250)) {
        const current = await this.getVariants(
          productChunk.map(({ write }) => write.variantId),
        );
        const currentById = new Map(
          current.map((variant) => [variant.variantId, variant]),
        );
        const eligible: typeof productChunk = [];

        for (const item of productChunk) {
          const variant = currentById.get(item.write.variantId);
          const skuConflict =
            !variant ||
            ("expectedSku" in item.write &&
              variant.sku !== item.write.expectedSku);
          const barcodeConflict =
            !variant ||
            ("expectedBarcode" in item.write &&
              variant.barcode !== item.write.expectedBarcode);
          const barcodeBlocked =
            variant !== undefined &&
            item.write.barcode !== undefined &&
            !canWriteBarcode(variant.barcode, item.write.barcode, {
              allowOverwrite: item.write.allowBarcodeOverwrite,
            });
          if (skuConflict || barcodeConflict || barcodeBlocked) {
            results.set(item.inputIndex, {
              variantId: item.write.variantId,
              status: "skipped_conflict",
              message: barcodeBlocked
                ? "A non-empty barcode cannot be overwritten without explicit consent."
                : "The variant changed after it was read.",
            });
          } else {
            eligible.push(item);
          }
        }
        if (eligible.length === 0) continue;

        try {
          const data = await this.client.request<{
            productVariantsBulkUpdate: {
              productVariants: Array<{ id: string }>;
              userErrors: MutationUserError[];
            };
          }>(
            UPDATE_VARIANTS,
            {
              productId,
              variants: eligible.map(({ write }) => ({
                id: write.variantId,
                ...(write.sku === undefined ? {} : { sku: write.sku }),
                ...(write.barcode === undefined
                  ? {}
                  : { barcode: write.barcode }),
              })),
            },
            Math.max(10, eligible.length * 10),
          );
          const payload = data.productVariantsBulkUpdate;
          const errorsByIndex = new Map<number, string[]>();
          const globalErrors: string[] = [];
          for (const error of payload.userErrors) {
            const indexPart = error.field?.find((part) => /^\d+$/.test(part));
            if (indexPart === undefined) {
              globalErrors.push(error.message);
            } else {
              const index = Number(indexPart);
              const messages = errorsByIndex.get(index) ?? [];
              messages.push(error.message);
              errorsByIndex.set(index, messages);
            }
          }
          eligible.forEach((item, eligibleIndex) => {
            const messages = [
              ...globalErrors,
              ...(errorsByIndex.get(eligibleIndex) ?? []),
            ];
            results.set(item.inputIndex, {
              variantId: item.write.variantId,
              status: messages.length > 0 ? "error" : "applied",
              ...(messages.length > 0 ? { message: messages.join("; ") } : {}),
            });
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unknown catalog write error.";
          for (const item of eligible) {
            results.set(item.inputIndex, {
              variantId: item.write.variantId,
              status: "error",
              message,
            });
          }
        }
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
}
