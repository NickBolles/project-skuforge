import type { GenerationJob, PrismaClient } from "@prisma/client";
import type { CatalogVariant, ShopifyCatalog, VariantFilter } from "../adapters/shopify/catalog";
import {
  exportCsvChunk,
  parseImportCsv,
  validateCsvImport,
  type CsvImportReport,
} from "../core/csv";
import { listEditorPage } from "./editor.server";
import { runGenerationJob, withCatalogBulkMutex } from "./generation.server";
import { ensureShop } from "./rules.server";

export interface CsvDryRunOptions {
  includeBarcodeOverwrites?: boolean;
}

async function catalogSnapshot(catalog: ShopifyCatalog, shopId: string) {
  return withCatalogBulkMutex(shopId, async () => {
    const variants: CatalogVariant[] = [];
    for await (const batch of catalog.streamAllVariants({ batchSize: 250 })) variants.push(...batch);
    return variants;
  });
}

export async function dryRunCsvImport(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  shopDomain: string,
  source: string,
  options: CsvDryRunOptions = {},
): Promise<CsvImportReport> {
  const parsed = parseImportCsv(source);
  const shop = await ensureShop(db, shopDomain);
  const [catalogVariants, defaultRule] = await Promise.all([
    catalogSnapshot(catalog, shop.id),
    db.skuRuleSet.findFirst({ where: { shopId: shop.id, isDefault: true, active: true } }),
  ]);
  return validateCsvImport(parsed.rows, catalogVariants, {
    includeBarcodeOverwrites: options.includeBarcodeOverwrites,
    defaultRulePattern: defaultRule?.pattern,
    globalIssues: parsed.issues,
  });
}

async function createCsvJob(
  db: PrismaClient,
  shopDomain: string,
  report: CsvImportReport,
  idempotencyKey: string,
): Promise<GenerationJob> {
  if (!idempotencyKey.trim()) throw new Error("An idempotency key is required.");
  const shop = await ensureShop(db, shopDomain);
  const existing = await db.generationJob.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.shopId !== shop.id) throw new Error("Idempotency key belongs to another shop.");
    return existing;
  }
  const applicable = report.rows.filter((row) => row.eligibleForApply);
  const fields = [...new Set(applicable.flatMap((row) => [
    ...(row.skuChanged ? ["sku"] : []),
    ...(row.barcodeChanged ? ["barcode"] : []),
  ]))];
  if (applicable.some((row) => row.issues.some((entry) => entry.code === "barcode_overwrite"))) {
    fields.push("barcode_overwrite");
  }
  return db.$transaction(async (tx) => {
    const job = await tx.generationJob.create({
      data: {
        shopId: shop.id,
        ruleSetId: "csv-import",
        trigger: "csv",
        fields: JSON.stringify(fields),
        status: "previewing",
        idempotencyKey,
        totals: JSON.stringify({ planned: applicable.length, applied: 0, skippedConflict: 0, errored: 0 }),
      },
    });
    if (applicable.length) {
      await tx.generationJobItem.createMany({
        data: applicable.map((row) => ({
          jobId: job.id,
          variantId: row.row.variant_id,
          productId: "csv-import",
          proposedSku: row.skuChanged ? row.row.sku : null,
          proposedBarcode: row.barcodeChanged ? row.row.barcode : null,
          expectedSku: row.currentSku,
          expectedBarcode: row.currentBarcode,
        })),
      });
    }
    return job;
  });
}

export async function applyCsvImport(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  shopDomain: string,
  source: string,
  options: CsvDryRunOptions & { idempotencyKey: string },
) {
  const report = await dryRunCsvImport(db, catalog, shopDomain, source, options);
  if (report.globalIssues.some((issue) => issue.severity === "block")) {
    throw new Error("CSV structure is invalid. Review the dry-run report before applying.");
  }
  const job = await createCsvJob(db, shopDomain, report, options.idempotencyKey);
  const result = await runGenerationJob(db, catalog, job.id, { source: "ui" });
  return { report, ...result };
}

export function streamEditorCsv(options: {
  db: PrismaClient;
  catalog: ShopifyCatalog;
  shopDomain: string;
  filter?: VariantFilter;
  duplicateOnly?: boolean;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let cursor: string | undefined;
        let first = true;
        do {
          const page = await listEditorPage(options.db, options.catalog, options.shopDomain, {
            cursor,
            pageSize: 250,
            filter: options.filter,
            duplicateOnly: options.duplicateOnly,
          });
          if (first || page.variants.length) {
            controller.enqueue(encoder.encode(exportCsvChunk(page.variants, { header: first, bom: first })));
          }
          first = false;
          cursor = page.hasNext && page.cursor ? page.cursor : undefined;
        } while (cursor);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
