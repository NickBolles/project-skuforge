import { CatalogError, type CatalogVariant } from "./catalog";
import type { FetchLike, ThrottledGraphqlClient } from "./throttle";

export const BULK_VARIANTS_QUERY = `#graphql
  query SKUForgeBulkVariants {
    products {
      edges {
        node {
          id title vendor productType tags status updatedAt
          variants {
            edges {
              node {
                id title sku barcode price updatedAt
                selectedOptions { name value }
              }
            }
          }
        }
      }
    }
  }
`;

const RUN_BULK_OPERATION = `#graphql
  mutation SKUForgeRunBulkOperation($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const CURRENT_BULK_OPERATION = `#graphql
  query SKUForgeCurrentBulkOperation {
    currentBulkOperation(type: QUERY) { id status errorCode url objectCount }
  }
`;

interface BulkOperationNode {
  id: string;
  status: string;
  errorCode?: string | null;
  url?: string | null;
  objectCount?: string;
}

interface UserError {
  field?: string[] | null;
  message: string;
}

export interface BulkLifecycleOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function startAndWaitForBulkVariants(
  client: ThrottledGraphqlClient,
  options: BulkLifecycleOptions = {},
): Promise<string> {
  const started = await client.request<{
    bulkOperationRunQuery: {
      bulkOperation: BulkOperationNode | null;
      userErrors: UserError[];
    };
  }>(RUN_BULK_OPERATION, { query: BULK_VARIANTS_QUERY }, 10);
  const payload = started.bulkOperationRunQuery;
  if (payload.userErrors.length > 0 || !payload.bulkOperation) {
    const message = payload.userErrors.map((error) => error.message).join("; ");
    if (/already|running/i.test(message)) {
      throw new CatalogError("BULK_OP_ALREADY_RUNNING", message);
    }
    throw new CatalogError(
      "BULK_OP_FAILED",
      message || "Bulk operation did not start.",
    );
  }

  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;

  for (;;) {
    if (now() - startedAt > timeoutMs) {
      throw new CatalogError("BULK_OP_TIMEOUT", "Bulk operation timed out.");
    }
    const polled = await client.request<{
      currentBulkOperation: BulkOperationNode | null;
    }>(CURRENT_BULK_OPERATION, {}, 2);
    const operation = polled.currentBulkOperation;
    if (!operation || operation.id !== payload.bulkOperation.id) {
      throw new CatalogError(
        "BULK_OP_FAILED",
        "The active bulk operation changed.",
      );
    }
    if (operation.status === "COMPLETED") {
      if (!operation.url) {
        throw new CatalogError(
          "BULK_OP_FAILED",
          "Completed bulk operation has no result URL.",
        );
      }
      return operation.url;
    }
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new CatalogError(
        "BULK_OP_FAILED",
        `Bulk operation ${operation.status.toLowerCase()}: ${operation.errorCode ?? "unknown"}.`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

async function* responseLines(response: Response): AsyncIterable<string> {
  if (!response.ok) {
    throw new CatalogError(
      "BULK_OP_FAILED",
      `Bulk result download returned HTTP ${response.status}.`,
    );
  }
  if (!response.body) {
    for (const line of (await response.text()).split(/\r?\n/)) {
      if (line.trim()) yield line;
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield line;
    if (done) break;
  }
  if (pending.trim()) yield pending;
}

interface ProductRow {
  id: string;
  title?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: CatalogVariant["status"];
  updatedAt?: string;
}

interface VariantRow {
  id: string;
  __parentId?: string;
  title?: string;
  sku?: string | null;
  barcode?: string | null;
  price?: string;
  updatedAt?: string;
  selectedOptions?: Array<{ name: string; value: string }>;
  product?: ProductRow;
}

function isVariantRow(row: ProductRow | VariantRow): row is VariantRow {
  return row.id.includes("/ProductVariant/");
}

function toVariant(row: VariantRow, product: ProductRow): CatalogVariant {
  return {
    productId: product.id,
    variantId: row.id,
    productTitle: product.title ?? "",
    variantTitle: row.title ?? "",
    vendor: product.vendor ?? "",
    productType: product.productType ?? "",
    tags: Array.isArray(product.tags) ? [...product.tags] : [],
    options: Object.fromEntries(
      (row.selectedOptions ?? []).map((option) => [option.name, option.value]),
    ),
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    price: row.price ?? "0.00",
    status: product.status ?? "ACTIVE",
    updatedAt: row.updatedAt ?? product.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function* streamBulkVariantsFromUrl(
  fetchImpl: FetchLike,
  url: string,
): AsyncIterable<CatalogVariant> {
  const response = await fetchImpl(url, { method: "GET" });
  const products = new Map<string, ProductRow>();
  const pending = new Map<string, VariantRow[]>();

  for await (const line of responseLines(response)) {
    let row: ProductRow | VariantRow;
    try {
      row = JSON.parse(line) as ProductRow | VariantRow;
    } catch {
      throw new CatalogError(
        "BULK_OP_FAILED",
        "Bulk result contains invalid JSONL.",
      );
    }
    if (!row.id) {
      throw new CatalogError(
        "BULK_OP_FAILED",
        "Bulk result row is missing an id.",
      );
    }
    if (!isVariantRow(row)) {
      products.set(row.id, row);
      for (const variant of pending.get(row.id) ?? [])
        yield toVariant(variant, row);
      pending.delete(row.id);
      continue;
    }

    const embeddedProduct = row.product;
    const productId = embeddedProduct?.id ?? row.__parentId;
    if (!productId) {
      throw new CatalogError(
        "BULK_OP_FAILED",
        `Variant ${row.id} has no parent product.`,
      );
    }
    const product = embeddedProduct ?? products.get(productId);
    if (product) {
      yield toVariant(row, product);
    } else {
      const variants = pending.get(productId) ?? [];
      variants.push(row);
      pending.set(productId, variants);
    }
  }

  if (pending.size > 0) {
    throw new CatalogError(
      "BULK_OP_FAILED",
      "Bulk result contains unresolved parent rows.",
    );
  }
}
