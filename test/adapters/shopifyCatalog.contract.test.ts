import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { scanCatalog } from "../../app/core/validate";
import {
  CatalogError,
  type CatalogVariant,
  type ShopifyCatalog,
} from "../../app/adapters/shopify/catalog";
import { GraphqlShopifyCatalog } from "../../app/adapters/shopify/graphqlCatalog";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import type { FetchLike } from "../../app/adapters/shopify/throttle";
import { generateCatalog } from "../fixtures/gen-catalog";
import contractSeedJson from "../fixtures/graphql/catalog-contract.json";
import bulkComplete from "../fixtures/graphql/bulk-complete.json";
import bulkFailed from "../fixtures/graphql/bulk-failed.json";
import bulkRun from "../fixtures/graphql/bulk-run.json";
import bulkRunning from "../fixtures/graphql/bulk-running.json";
import throttled from "../fixtures/graphql/throttled.json";
import updateSuccess from "../fixtures/graphql/update-success.json";
import updateUserErrors from "../fixtures/graphql/update-user-errors.json";

const contractSeed = contractSeedJson as unknown as CatalogVariant[];
const bulkJsonl = readFileSync(
  new URL("../fixtures/graphql/bulk-variants.jsonl", import.meta.url),
  "utf8",
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function normalized(value: string): string {
  return value.trim().toUpperCase();
}

function graphNode(variant: CatalogVariant) {
  return {
    id: variant.variantId,
    title: variant.variantTitle,
    sku: variant.sku,
    barcode: variant.barcode,
    price: variant.price,
    updatedAt: variant.updatedAt,
    selectedOptions: Object.entries(variant.options).map(([name, value]) => ({
      name,
      value,
    })),
    product: {
      id: variant.productId,
      title: variant.productTitle,
      vendor: variant.vendor,
      productType: variant.productType,
      tags: [...variant.tags],
      status: variant.status,
      updatedAt: variant.updatedAt,
    },
  };
}

function decodeQuoted(value: string): string {
  return JSON.parse(`"${value}"`) as string;
}

class RecordedGraphqlTransport {
  readonly variants = contractSeed.map(clone);
  readonly productWrites: Array<{ productId: string; variantIds: string[] }> =
    [];
  pollCount = 0;
  failBulk = false;
  alwaysRunning = false;
  throttleNextUpdate = false;
  mutateOnSecondGet: { variantId: string; sku: string } | null = null;
  private throttledOnce = false;
  private getRequests = 0;

  private filter(query: string | null): CatalogVariant[] {
    if (!query) return this.variants;
    const exactTerms = [
      ...query.matchAll(/\b(sku|barcode):"((?:\\.|[^"])*)"/g),
    ];
    if (query.includes(" OR ") && exactTerms.length > 0) {
      return this.variants.filter((variant) =>
        exactTerms.some((term) => {
          const field = term[1] as "sku" | "barcode";
          const value = variant[field];
          return (
            value !== null &&
            normalized(value) === normalized(decodeQuoted(term[2]!))
          );
        }),
      );
    }

    let filtered = [...this.variants];
    const vendor = /vendor:"((?:\\.|[^"])*)"/.exec(query)?.[1];
    const productType = /product_type:"((?:\\.|[^"])*)"/.exec(query)?.[1];
    if (vendor) {
      filtered = filtered.filter(
        (variant) =>
          normalized(variant.vendor) === normalized(decodeQuoted(vendor)),
      );
    }
    if (productType) {
      filtered = filtered.filter(
        (variant) =>
          normalized(variant.productType) ===
          normalized(decodeQuoted(productType)),
      );
    }
    if (query.includes("-sku:*")) {
      filtered = filtered.filter((variant) => !variant.sku?.trim());
    }
    if (query.includes("-barcode:*")) {
      filtered = filtered.filter((variant) => !variant.barcode?.trim());
    }
    const text = query
      .split(" AND ")
      .find((term) => !term.includes(":") && term.trim());
    if (text) {
      const needle = text.trim().toLocaleLowerCase();
      filtered = filtered.filter((variant) =>
        [
          variant.productTitle,
          variant.variantTitle,
          variant.vendor,
          variant.productType,
          variant.sku ?? "",
          ...variant.tags,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle),
      );
    }
    return filtered;
  }

  readonly fetch: FetchLike = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url === "https://fixtures.test/bulk-1.jsonl") {
      return new Response(bulkJsonl, { status: 200 });
    }
    const request = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const { query, variables } = request;

    if (query.includes("SKUForgeRunBulkOperation")) {
      this.pollCount = 0;
      return response(clone(bulkRun));
    }
    if (query.includes("SKUForgeCurrentBulkOperation")) {
      this.pollCount += 1;
      if (this.failBulk) return response(clone(bulkFailed));
      if (this.alwaysRunning || this.pollCount === 1)
        return response(clone(bulkRunning));
      return response(clone(bulkComplete));
    }
    if (query.includes("SKUForgeCountVariants")) {
      return response({
        data: { productVariantsCount: { count: this.variants.length } },
      });
    }
    if (query.includes("SKUForgeGetVariants")) {
      this.getRequests += 1;
      if (this.getRequests === 2 && this.mutateOnSecondGet) {
        this.mutateVariant(this.mutateOnSecondGet.variantId, {
          sku: this.mutateOnSecondGet.sku,
        });
      }
      const ids = variables.ids as string[];
      return response({
        data: {
          nodes: ids.map((id) => {
            const variant = this.variants.find((item) => item.variantId === id);
            return variant ? graphNode(variant) : null;
          }),
        },
      });
    }
    if (
      query.includes("SKUForgeListVariants") ||
      query.includes("SKUForgeFindVariants")
    ) {
      const matching = this.filter((variables.query as string | null) ?? null);
      const after = variables.after as string | null;
      const start = after
        ? Math.max(
            0,
            matching.findIndex(
              (variant) => `recorded:${variant.variantId}` === after,
            ) + 1,
          )
        : 0;
      const first = variables.first as number;
      const page = matching.slice(start, start + first);
      const endCursor =
        page.length === 0
          ? null
          : `recorded:${page[page.length - 1]!.variantId}`;
      return response({
        data: {
          productVariants: {
            edges: page.map((variant) => ({
              cursor: `recorded:${variant.variantId}`,
              node: graphNode(variant),
            })),
            pageInfo: {
              hasNextPage: start + page.length < matching.length,
              endCursor,
            },
          },
        },
      });
    }
    if (query.includes("SKUForgeUpdateVariants")) {
      if (this.throttleNextUpdate && !this.throttledOnce) {
        this.throttledOnce = true;
        return response(clone(throttled));
      }
      const productId = variables.productId as string;
      const writes = variables.variants as Array<{
        id: string;
        sku?: string;
        barcode?: string;
      }>;
      this.productWrites.push({
        productId,
        variantIds: writes.map((write) => write.id),
      });
      if (writes.some((write) => write.id.endsWith("/5"))) {
        return response(clone(updateUserErrors));
      }
      for (const write of writes) {
        const position = this.variants.findIndex(
          (variant) => variant.variantId === write.id,
        );
        if (position >= 0) {
          this.variants[position] = {
            ...this.variants[position]!,
            ...(write.sku === undefined ? {} : { sku: write.sku }),
            ...(write.barcode === undefined ? {} : { barcode: write.barcode }),
          };
        }
      }
      const payload = clone(updateSuccess) as unknown as {
        data: {
          productVariantsBulkUpdate: {
            productVariants: Array<{ id: string }>;
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };
      };
      payload.data.productVariantsBulkUpdate.productVariants = writes.map(
        (write) => ({
          id: write.id,
        }),
      );
      return response(payload);
    }
    throw new Error(
      `Unexpected recorded GraphQL operation: ${query.slice(0, 80)}`,
    );
  };

  mutateVariant(variantId: string, patch: Partial<CatalogVariant>): void {
    const position = this.variants.findIndex(
      (variant) => variant.variantId === variantId,
    );
    if (position < 0) throw new Error(`Unknown variant ${variantId}`);
    this.variants[position] = { ...this.variants[position]!, ...patch };
  }
}

interface CatalogHarness {
  catalog: ShopifyCatalog;
  productWrites: Array<{ productId: string; variantIds: string[] }>;
  mutateVariant(variantId: string, patch: Partial<CatalogVariant>): void;
}

function memoryHarness(): CatalogHarness {
  const productWrites: CatalogHarness["productWrites"] = [];
  const catalog = new InMemoryShopifyCatalog(contractSeed, {
    simulate: {
      bulkOpDelay: 20,
      errorVariantIds: ["gid://shopify/ProductVariant/5"],
    },
    onProductWrite: (productId, writes) =>
      productWrites.push({
        productId,
        variantIds: writes.map((write) => write.variantId),
      }),
  });
  return {
    catalog,
    productWrites,
    mutateVariant: (variantId, patch) => {
      if (!catalog.mutateVariant(variantId, patch))
        throw new Error("Unknown variant");
    },
  };
}

function graphqlHarness(): CatalogHarness {
  const transport = new RecordedGraphqlTransport();
  const catalog = new GraphqlShopifyCatalog(
    "fixture-shop.test",
    "fixture-token",
    {
      endpoint: "https://fixture-shop.test/admin/api/2025-10/graphql.json",
      fetch: transport.fetch,
      pollIntervalMs: 20,
      sleep: async (milliseconds) =>
        new Promise((resolve) =>
          setTimeout(resolve, Math.min(milliseconds, 20)),
        ),
      retryBaseMs: 5,
    },
  );
  return {
    catalog,
    productWrites: transport.productWrites,
    mutateVariant: (variantId, patch) =>
      transport.mutateVariant(variantId, patch),
  };
}

const implementations = [
  { name: "in-memory", create: memoryHarness },
  { name: "recorded GraphQL", create: graphqlHarness },
];

async function collect(
  stream: AsyncIterable<CatalogVariant[]>,
): Promise<CatalogVariant[][]> {
  const batches: CatalogVariant[][] = [];
  for await (const batch of stream) batches.push(batch);
  return batches;
}

function iteratorOf(stream: AsyncIterable<CatalogVariant[]>) {
  return stream[Symbol.asyncIterator]();
}

describe.each(implementations)(
  "ShopifyCatalog contract: $name",
  ({ create }) => {
    let harness: CatalogHarness;

    beforeEach(() => {
      harness = create();
    });

    it("streams every variant in requested batches after completion", async () => {
      const streamed = await collect(
        harness.catalog.streamAllVariants({ batchSize: 2 }),
      );
      expect(streamed.map((batch) => batch.length)).toEqual([2, 2, 1]);
      expect(streamed.flat().map((variant) => variant.variantId)).toEqual(
        contractSeed.map((variant) => variant.variantId),
      );
    });

    it("does not yield progressive data before bulk completion", async () => {
      const iterator = iteratorOf(
        harness.catalog.streamAllVariants({ batchSize: 2 }),
      );
      let settled = false;
      const first = iterator.next().then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 3));
      expect(settled).toBe(false);
      await expect(first).resolves.toMatchObject({ done: false });
      await iterator.return?.();
    });

    it("rejects a concurrent bulk stream", async () => {
      const first = iteratorOf(harness.catalog.streamAllVariants());
      const firstBatch = first.next();
      await Promise.resolve();
      const second = iteratorOf(harness.catalog.streamAllVariants());
      await expect(second.next()).rejects.toMatchObject({
        code: "BULK_OP_ALREADY_RUNNING",
      });
      await firstBatch;
      await first.return?.();
    });

    it("provides stable cursor pagination", async () => {
      const page1 = await harness.catalog.listVariantsPage({ pageSize: 2 });
      const repeated = await harness.catalog.listVariantsPage({ pageSize: 2 });
      const page2 = await harness.catalog.listVariantsPage({
        pageSize: 2,
        cursor: page1.cursor!,
      });
      expect(page1.cursor).toBe(repeated.cursor);
      expect(page1.hasNext).toBe(true);
      expect(page1.variants.map((variant) => variant.variantId)).toEqual(
        contractSeed.slice(0, 2).map((variant) => variant.variantId),
      );
      expect(page2.variants.map((variant) => variant.variantId)).toEqual(
        contractSeed.slice(2, 4).map((variant) => variant.variantId),
      );
    });

    it("implements interactive filter semantics", async () => {
      const vendor = await harness.catalog.listVariantsPage({
        pageSize: 10,
        filter: { vendor: " acme " },
      });
      const type = await harness.catalog.listVariantsPage({
        pageSize: 10,
        filter: { productType: "mug" },
      });
      const missing = await harness.catalog.listVariantsPage({
        pageSize: 10,
        filter: { missingSku: true, missingBarcode: true },
      });
      const text = await harness.catalog.listVariantsPage({
        pageSize: 10,
        filter: { text: "special" },
      });
      expect(vendor.variants.map((variant) => variant.variantId)).toEqual([
        "gid://shopify/ProductVariant/1",
        "gid://shopify/ProductVariant/2",
      ]);
      expect(type.variants).toHaveLength(2);
      expect(missing.variants.map((variant) => variant.variantId)).toEqual([
        "gid://shopify/ProductVariant/4",
      ]);
      expect(text.variants.map((variant) => variant.variantId)).toEqual([
        "gid://shopify/ProductVariant/5",
      ]);
    });

    it("finds exact normalized SKU and barcode matches", async () => {
      const sku = await harness.catalog.findVariantsBySku([" SKU-b "]);
      const barcode = await harness.catalog.findVariantsBySku(
        [" 300 "],
        "barcode",
      );
      expect(sku.map((variant) => variant.variantId)).toEqual([
        "gid://shopify/ProductVariant/2",
        "gid://shopify/ProductVariant/3",
      ]);
      expect(barcode.map((variant) => variant.variantId)).toEqual([
        "gid://shopify/ProductVariant/3",
      ]);
    });

    it("counts and retrieves variants in requested order", async () => {
      await expect(harness.catalog.countVariants()).resolves.toBe(5);
      const variants = await harness.catalog.getVariants([
        "gid://shopify/ProductVariant/3",
        "missing",
        "gid://shopify/ProductVariant/1",
      ]);
      expect(variants.map((variant) => variant.variantId)).toEqual([
        "gid://shopify/ProductVariant/3",
        "gid://shopify/ProductVariant/1",
      ]);
    });

    it("groups writes per product and preserves result order", async () => {
      const results = await harness.catalog.updateVariants([
        {
          variantId: "gid://shopify/ProductVariant/1",
          sku: "NEW-1",
          expectedSku: "SKU-A",
        },
        {
          variantId: "gid://shopify/ProductVariant/3",
          sku: "NEW-3",
          expectedSku: "SKU-B",
        },
        {
          variantId: "gid://shopify/ProductVariant/2",
          sku: "NEW-2",
          expectedSku: " sku-b ",
        },
      ]);
      expect(results).toEqual([
        { variantId: "gid://shopify/ProductVariant/1", status: "applied" },
        { variantId: "gid://shopify/ProductVariant/3", status: "applied" },
        { variantId: "gid://shopify/ProductVariant/2", status: "applied" },
      ]);
      expect(harness.productWrites).toEqual([
        {
          productId: "gid://shopify/Product/1",
          variantIds: [
            "gid://shopify/ProductVariant/1",
            "gid://shopify/ProductVariant/2",
          ],
        },
        {
          productId: "gid://shopify/Product/2",
          variantIds: ["gid://shopify/ProductVariant/3"],
        },
      ]);
    });

    it("maps per-variant user errors without throwing", async () => {
      const [result] = await harness.catalog.updateVariants([
        {
          variantId: "gid://shopify/ProductVariant/5",
          sku: "REJECTED",
          expectedSku: "SKU-E",
        },
      ]);
      expect(result).toMatchObject({
        variantId: "gid://shopify/ProductVariant/5",
        status: "error",
      });
      expect(result?.message).toBeTruthy();
    });

    it("reports compare-and-set conflicts", async () => {
      harness.mutateVariant("gid://shopify/ProductVariant/3", {
        sku: "MERCHANT-EDIT",
      });
      await expect(
        harness.catalog.updateVariants([
          {
            variantId: "gid://shopify/ProductVariant/3",
            sku: "APP-EDIT",
            expectedSku: "SKU-B",
          },
        ]),
      ).resolves.toEqual([
        {
          variantId: "gid://shopify/ProductVariant/3",
          status: "skipped_conflict",
          message: "The variant changed after it was read.",
        },
      ]);
    });

    it("guards non-empty barcodes unless overwrite consent is explicit", async () => {
      const [blocked] = await harness.catalog.updateVariants([
        {
          variantId: "gid://shopify/ProductVariant/2",
          barcode: "201",
          expectedBarcode: "200",
        },
      ]);
      // skipped_conflict is returned for three different reasons — a SKU CAS
      // miss, a barcode CAS miss, and this guard — and only the message tells
      // them apart. Assert the whole result so a block for the wrong reason
      // fails here, and re-read the variant so a "blocked" verdict that still
      // wrote the barcode cannot pass.
      expect(blocked).toEqual({
        variantId: "gid://shopify/ProductVariant/2",
        status: "skipped_conflict",
        message:
          "A non-empty barcode cannot be overwritten without explicit consent.",
      });
      const [untouched] = await harness.catalog.getVariants([
        "gid://shopify/ProductVariant/2",
      ]);
      expect(untouched?.barcode).toBe("200");
      const [applied] = await harness.catalog.updateVariants([
        {
          variantId: "gid://shopify/ProductVariant/2",
          barcode: "201",
          expectedBarcode: "200",
          allowBarcodeOverwrite: true,
        },
      ]);
      expect(applied).toEqual({
        variantId: "gid://shopify/ProductVariant/2",
        status: "applied",
      });
    });

    it("returns an error result for unknown variants", async () => {
      await expect(
        harness.catalog.updateVariants([{ variantId: "missing", sku: "NOPE" }]),
      ).resolves.toEqual([
        {
          variantId: "missing",
          status: "error",
          message: "Variant was not found.",
        },
      ]);
    });
  },
);

describe("InMemoryShopifyCatalog simulations", () => {
  it("mutates during a stream and then catches stale CAS writes", async () => {
    const catalog = new InMemoryShopifyCatalog(contractSeed, {
      simulate: {
        mutateDuringStream: (current, completedBatch) => {
          if (completedBatch === 0) {
            current.mutateVariant("gid://shopify/ProductVariant/3", {
              sku: "MID-STREAM-EDIT",
            });
          }
        },
      },
    });
    await collect(catalog.streamAllVariants({ batchSize: 2 }));
    await expect(
      catalog.updateVariants([
        {
          variantId: "gid://shopify/ProductVariant/3",
          sku: "APP",
          expectedSku: "SKU-B",
        },
      ]),
    ).resolves.toMatchObject([{ status: "skipped_conflict" }]);
  });

  it("exercises the throttle simulation knob", async () => {
    const catalog = new InMemoryShopifyCatalog(contractSeed, {
      simulate: { throttleEveryN: 1 },
    });
    await catalog.updateVariants([
      { variantId: "gid://shopify/ProductVariant/1", sku: "NEW" },
      { variantId: "gid://shopify/ProductVariant/3", sku: "NEWER" },
    ]);
    expect(catalog.throttleEvents).toEqual([1, 2]);
  });

  it("streams and scans 10k variants in under five seconds", async () => {
    const catalog = new InMemoryShopifyCatalog(
      generateCatalog({ variants: 10_000 }),
    );
    const started = performance.now();
    const result = await scanCatalog(
      catalog.streamAllVariants({ batchSize: 211 }),
    );
    expect(result.summary.variantsScanned).toBe(10_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe("GraphqlShopifyCatalog recorded failure fixtures", () => {
  it("maps a failed bulk lifecycle", async () => {
    const transport = new RecordedGraphqlTransport();
    transport.failBulk = true;
    const catalog = new GraphqlShopifyCatalog("fixture.test", "token", {
      fetch: transport.fetch,
      pollIntervalMs: 0,
    });
    const next = catalog.streamAllVariants()[Symbol.asyncIterator]().next();
    await expect(next).rejects.toMatchObject({ code: "BULK_OP_FAILED" });
  });

  it("times out a bulk lifecycle", async () => {
    const transport = new RecordedGraphqlTransport();
    transport.alwaysRunning = true;
    let clock = 0;
    const catalog = new GraphqlShopifyCatalog("fixture.test", "token", {
      fetch: transport.fetch,
      pollIntervalMs: 0,
      timeoutMs: 50,
      now: () => (clock += 100),
      sleep: async () => undefined,
    });
    await expect(
      catalog.streamAllVariants()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: "BULK_OP_TIMEOUT" });
  });

  it("backs off and retries a throttled mutation", async () => {
    const transport = new RecordedGraphqlTransport();
    transport.throttleNextUpdate = true;
    const sleeps: number[] = [];
    const catalog = new GraphqlShopifyCatalog("fixture.test", "token", {
      fetch: transport.fetch,
      retryBaseMs: 7,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });
    await expect(
      catalog.updateVariants([
        {
          variantId: "gid://shopify/ProductVariant/1",
          sku: "RETRIED",
          expectedSku: "SKU-A",
        },
      ]),
    ).resolves.toEqual([
      { variantId: "gid://shopify/ProductVariant/1", status: "applied" },
    ]);
    expect(sleeps).toContain(7);
    expect(transport.productWrites).toHaveLength(1);
  });

  it("re-fetches immediately before writing and catches a mid-call edit", async () => {
    const transport = new RecordedGraphqlTransport();
    transport.mutateOnSecondGet = {
      variantId: "gid://shopify/ProductVariant/1",
      sku: "MERCHANT-MID-CALL",
    };
    const catalog = new GraphqlShopifyCatalog("fixture.test", "token", {
      fetch: transport.fetch,
    });
    await expect(
      catalog.updateVariants([
        {
          variantId: "gid://shopify/ProductVariant/1",
          sku: "APP",
          expectedSku: "SKU-A",
        },
      ]),
    ).resolves.toMatchObject([{ status: "skipped_conflict" }]);
    expect(transport.productWrites).toEqual([]);
  });
});

it("uses structured catalog errors", () => {
  expect(new CatalogError("INVALID_CURSOR", "bad")).toMatchObject({
    name: "CatalogError",
    code: "INVALID_CURSOR",
  });
});
