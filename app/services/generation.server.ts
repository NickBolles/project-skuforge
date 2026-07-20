import { Prisma, type GenerationJob, type PrismaClient } from "@prisma/client";
import type { CatalogVariant, ShopifyCatalog } from "../adapters/shopify/catalog";
import { formatInternalBarcode, type InternalBarcodeSettings } from "../core/barcode";
import { validateCsvImport, type CsvVariantRow } from "../core/csv";
import { parsePattern, render, type PatternAst } from "../core/sku";
import { assignUnique, canWriteBarcode, DupIndex, normalizeSku } from "../core/validate";
import { acquireJobLock, heartbeatJobLock, JobLockedError, releaseJobLock } from "./job-lock.server";
import { ensureShop, getRule, parseRuleConfig } from "./rules.server";
import { allocateSequenceBlock } from "./sequence.server";
import { verifyGenerationRun } from "./verification.server";

export type GenerationTrigger = "all_missing" | "selected" | "webhook" | "fix" | "csv";

export interface GenerationTotals {
  planned: number;
  applied: number;
  skippedConflict: number;
  errored: number;
  duplicateGroups?: number;
  duplicateBarcodeGroups?: number;
  verificationScanId?: string;
}

export interface CreateGenerationInput {
  shopDomain: string;
  ruleSetId: string;
  trigger: "all_missing" | "selected";
  idempotencyKey: string;
  selectedVariantIds?: string[];
}

export interface BarcodeSettings extends InternalBarcodeSettings {
  startNumber: number;
}

export type CreateBarcodeGenerationInput = Omit<CreateGenerationInput, "ruleSetId"> & {
  ruleSetId?: string;
};

const DEFAULT_BARCODE_SETTINGS: BarcodeSettings = {
  prefix: "",
  digits: 12,
  startNumber: 1,
};

export function parseBarcodeSettings(settings: string | Record<string, unknown> | BarcodeSettings): BarcodeSettings {
  const parsed: Record<string, unknown> = typeof settings === "string"
    ? JSON.parse(settings || "{}") as Record<string, unknown>
    : { ...settings };
  const barcode = typeof parsed.barcode === "object" && parsed.barcode !== null
    ? parsed.barcode as Record<string, unknown>
    : parsed;
  const resolved = {
    prefix: typeof barcode.prefix === "string" ? barcode.prefix : DEFAULT_BARCODE_SETTINGS.prefix,
    digits: typeof barcode.digits === "number" ? barcode.digits : DEFAULT_BARCODE_SETTINGS.digits,
    startNumber: typeof barcode.startNumber === "number" ? barcode.startNumber : DEFAULT_BARCODE_SETTINGS.startNumber,
  };
  // Reuse the formatter as the single validation point for prefix/digit width.
  formatInternalBarcode(resolved.startNumber, resolved);
  return resolved;
}

export async function saveBarcodeSettings(
  db: PrismaClient,
  shopDomain: string,
  settings: BarcodeSettings,
): Promise<BarcodeSettings> {
  const validated = parseBarcodeSettings(settings);
  const shop = await ensureShop(db, shopDomain);
  const current = JSON.parse(shop.settings || "{}") as Record<string, unknown>;
  await db.shop.update({ where: { id: shop.id }, data: { settings: JSON.stringify({ ...current, barcode: validated }) } });
  return validated;
}

export interface RunGenerationOptions {
  source?: "ui" | "webhook";
  batchSize?: number;
  staleAfterMs?: number;
  crashAfterBatches?: number;
  drainQueue?: boolean;
}

export interface GenerationRunResult {
  job: GenerationJob;
  queued: boolean;
  verificationScanId?: string;
}

export class SimulatedGenerationCrash extends Error {
  constructor() {
    super("Simulated process crash; the lock and running cursor were intentionally preserved.");
    this.name = "SimulatedGenerationCrash";
  }
}

const bulkTails = new Map<string, Promise<void>>();

export async function withCatalogBulkMutex<T>(shopId: string, task: () => Promise<T>): Promise<T> {
  const previous = bulkTails.get(shopId) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => tail);
  bulkTails.set(shopId, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (bulkTails.get(shopId) === queued) bulkTails.delete(shopId);
  }
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function contextFor(variant: CatalogVariant) {
  return {
    vendor: variant.vendor,
    productType: variant.productType,
    productTitle: variant.productTitle,
    options: variant.options,
  };
}

function hasSequence(ast: PatternAst): boolean {
  return ast.nodes.some((node) => node.type === "token" && node.kind === "seq");
}

async function createJobRecord(
  db: PrismaClient,
  data: { shopId: string; ruleSetId: string; trigger: GenerationTrigger; idempotencyKey: string; fields: ("sku" | "barcode")[] },
): Promise<{ job: GenerationJob; created: boolean }> {
  try {
    const job = await db.generationJob.create({
      data: { ...data, fields: JSON.stringify(data.fields), totals: JSON.stringify({ planned: 0, applied: 0, skippedConflict: 0, errored: 0 }) },
    });
    return { job, created: true };
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    const job = await db.generationJob.findUniqueOrThrow({ where: { idempotencyKey: data.idempotencyKey } });
    if (job.shopId !== data.shopId) throw new Error("Idempotency key belongs to another shop.");
    return { job, created: false };
  }
}

async function catalogSnapshot(catalog: ShopifyCatalog, shopId: string): Promise<CatalogVariant[]> {
  return withCatalogBulkMutex(shopId, async () => {
    const variants: CatalogVariant[] = [];
    for await (const batch of catalog.streamAllVariants({ batchSize: 250 })) variants.push(...batch);
    return variants;
  });
}

async function allocateStart(db: PrismaClient, shopId: string, ruleId: string, count: number, ast: PatternAst): Promise<number> {
  if (!hasSequence(ast) || count === 0) return 1;
  return (await allocateSequenceBlock(db, shopId, `rule:${ruleId}`, count)).start;
}

export async function createBulkGenerationJob(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  input: CreateGenerationInput,
) {
  if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required.");
  const shop = await ensureShop(db, input.shopDomain);
  const rule = await getRule(db, input.shopDomain, input.ruleSetId);
  const record = await createJobRecord(db, {
    shopId: shop.id,
    ruleSetId: rule.id,
    trigger: input.trigger,
    idempotencyKey: input.idempotencyKey,
    fields: ["sku"],
  });
  if (!record.created) return db.generationJob.findUniqueOrThrow({ where: { id: record.job.id }, include: { items: true } });

  try {
    const parsed = parsePattern(rule.pattern);
    if (!parsed.ok) throw new Error(parsed.errors[0]!.message);
    const config = parseRuleConfig(rule.config);
    const all = await catalogSnapshot(catalog, shop.id);
    const selected = new Set(input.selectedVariantIds ?? []);
    const targets = all.filter((variant) => {
      if (input.trigger === "all_missing") return variant.sku === null || variant.sku.trim() === "";
      return selected.has(variant.variantId);
    });
    const index = new DupIndex();
    index.addBatch(all.map((variant) => ({ variantId: variant.variantId, sku: variant.sku })));
    const start = await allocateStart(db, shop.id, rule.id, targets.length, parsed.ast);
    const items = targets.map((variant, offset) => {
      const proposed = render(parsed.ast, contextFor(variant), start + offset, config);
      const assignment = assignUnique(proposed, index, { ownerId: variant.variantId });
      return {
        jobId: record.job.id,
        variantId: variant.variantId,
        productId: variant.productId,
        proposedSku: assignment.sku,
        expectedSku: variant.sku,
      };
    });
    if (items.length) await db.generationJobItem.createMany({ data: items });
    const totals: GenerationTotals = { planned: items.length, applied: 0, skippedConflict: 0, errored: 0 };
    await db.generationJob.update({ where: { id: record.job.id }, data: { status: "previewing", totals: JSON.stringify(totals) } });
    return db.generationJob.findUniqueOrThrow({ where: { id: record.job.id }, include: { items: true } });
  } catch (error) {
    await db.generationJob.update({ where: { id: record.job.id }, data: { status: "failed", error: error instanceof Error ? error.message : "Planning failed.", finishedAt: new Date() } });
    throw error;
  }
}

export async function createBulkBarcodeGenerationJob(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  input: CreateBarcodeGenerationInput,
) {
  if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required.");
  const shop = await ensureShop(db, input.shopDomain);
  const record = await createJobRecord(db, {
    shopId: shop.id,
    ruleSetId: input.ruleSetId ?? "internal-code128",
    trigger: input.trigger,
    idempotencyKey: input.idempotencyKey,
    fields: ["barcode"],
  });
  if (!record.created) return db.generationJob.findUniqueOrThrow({ where: { id: record.job.id }, include: { items: true } });

  try {
    const all = await catalogSnapshot(catalog, shop.id);
    const selected = new Set(input.selectedVariantIds ?? []);
    const targets = all.filter((variant) => {
      const inScope = input.trigger === "all_missing" || selected.has(variant.variantId);
      return inScope && canWriteBarcode(variant.barcode, "pending-generated-value");
    });
    const index = new DupIndex();
    index.addBatch(all.map((variant) => ({ variantId: variant.variantId, sku: variant.barcode })));
    const settings = parseBarcodeSettings(shop.settings);
    const block = targets.length
      ? await allocateSequenceBlock(db, shop.id, "barcode", targets.length, settings.startNumber)
      : null;
    const items = [];
    let sequence = block?.start ?? settings.startNumber;
    for (const variant of targets) {
      let proposed = formatInternalBarcode(sequence, settings);
      while (index.has(proposed, variant.variantId)) {
        const extra = await allocateSequenceBlock(db, shop.id, "barcode", 1, settings.startNumber);
        proposed = formatInternalBarcode(extra.start, settings);
      }
      index.reserve(proposed, variant.variantId);
      items.push({
        jobId: record.job.id,
        variantId: variant.variantId,
        productId: variant.productId,
        proposedBarcode: proposed,
        expectedBarcode: variant.barcode,
      });
      sequence += 1;
    }
    if (items.length) await db.generationJobItem.createMany({ data: items });
    const totals: GenerationTotals = { planned: items.length, applied: 0, skippedConflict: 0, errored: 0 };
    await db.generationJob.update({ where: { id: record.job.id }, data: { status: "previewing", totals: JSON.stringify(totals) } });
    return db.generationJob.findUniqueOrThrow({ where: { id: record.job.id }, include: { items: true } });
  } catch (error) {
    await db.generationJob.update({ where: { id: record.job.id }, data: { status: "failed", error: error instanceof Error ? error.message : "Barcode planning failed.", finishedAt: new Date() } });
    throw error;
  }
}

export async function enqueueSingleVariantJob(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  input: { shopDomain: string; ruleSetId: string; trigger: "webhook" | "fix"; idempotencyKey: string; variantIds: string[] },
) {
  const shop = await ensureShop(db, input.shopDomain);
  const rule = await getRule(db, input.shopDomain, input.ruleSetId);
  const record = await createJobRecord(db, { shopId: shop.id, ruleSetId: rule.id, trigger: input.trigger, idempotencyKey: input.idempotencyKey, fields: ["sku"] });
  if (record.created) {
    const variants = await catalog.getVariants(input.variantIds);
    const missing = variants.filter((variant) => variant.sku === null || variant.sku.trim() === "");
    if (missing.length) {
      await db.generationJobItem.createMany({ data: missing.map((variant) => ({ jobId: record.job.id, variantId: variant.variantId, productId: variant.productId, expectedSku: variant.sku })) });
    }
    await db.generationJob.update({ where: { id: record.job.id }, data: { totals: JSON.stringify({ planned: missing.length, applied: 0, skippedConflict: 0, errored: 0 }) } });
  }
  return db.generationJob.findUniqueOrThrow({ where: { id: record.job.id }, include: { items: true } });
}

async function refreshBulkAssignments(db: PrismaClient, catalog: ShopifyCatalog, job: GenerationJob): Promise<void> {
  const all = await catalogSnapshot(catalog, job.shopId);
  const current = new Map(all.map((variant) => [variant.variantId, variant]));
  const index = new DupIndex();
  index.addBatch(all.map((variant) => ({ variantId: variant.variantId, sku: variant.sku })));
  const items = await db.generationJobItem.findMany({ where: { jobId: job.id, status: { not: "applied" } }, orderBy: { id: "asc" } });
  for (const item of items) {
    const variant = current.get(item.variantId);
    if (!variant || !item.proposedSku) {
      await db.generationJobItem.update({ where: { id: item.id }, data: { status: "error", message: "Variant or proposal is unavailable." } });
      continue;
    }
    const assignment = assignUnique(item.proposedSku, index, { ownerId: item.variantId });
    if (assignment.sku !== item.proposedSku) {
      await db.generationJobItem.update({ where: { id: item.id }, data: { proposedSku: assignment.sku } });
    }
  }
}

function generatesBarcode(job: GenerationJob): boolean {
  const fields = JSON.parse(job.fields) as string[];
  return fields.includes("barcode");
}

async function refreshBarcodeAssignments(db: PrismaClient, catalog: ShopifyCatalog, job: GenerationJob): Promise<void> {
  const all = await catalogSnapshot(catalog, job.shopId);
  const current = new Map(all.map((variant) => [variant.variantId, variant]));
  const index = new DupIndex();
  index.addBatch(all.map((variant) => ({ variantId: variant.variantId, sku: variant.barcode })));
  const shop = await db.shop.findUniqueOrThrow({ where: { id: job.shopId } });
  const settings = parseBarcodeSettings(shop.settings);
  const items = await db.generationJobItem.findMany({ where: { jobId: job.id, status: { not: "applied" } }, orderBy: { id: "asc" } });
  for (const item of items) {
    const variant = current.get(item.variantId);
    if (!variant || !item.proposedBarcode) {
      await db.generationJobItem.update({ where: { id: item.id }, data: { status: "error", message: "Variant or barcode proposal is unavailable." } });
      continue;
    }
    let proposed = item.proposedBarcode;
    while (index.has(proposed, item.variantId)) {
      const extra = await allocateSequenceBlock(db, job.shopId, "barcode", 1, settings.startNumber);
      proposed = formatInternalBarcode(extra.start, settings);
    }
    index.reserve(proposed, item.variantId);
    if (proposed !== item.proposedBarcode) {
      await db.generationJobItem.update({ where: { id: item.id }, data: { proposedBarcode: proposed } });
    }
  }
}

async function refreshCsvAssignments(db: PrismaClient, catalog: ShopifyCatalog, job: GenerationJob): Promise<void> {
  const all = await catalogSnapshot(catalog, job.shopId);
  const current = new Map(all.map((variant) => [variant.variantId, variant]));
  const items = await db.generationJobItem.findMany({
    where: { jobId: job.id, status: "planned" },
    orderBy: { id: "asc" },
  });
  const active: typeof items = [];
  for (const item of items) {
    const variant = current.get(item.variantId);
    if (!variant) {
      await db.generationJobItem.update({ where: { id: item.id }, data: { status: "error", message: "Variant was not found during CSV apply revalidation." } });
      continue;
    }
    const skuStale = item.proposedSku !== null && variant.sku !== item.expectedSku;
    const barcodeStale = item.proposedBarcode !== null && variant.barcode !== item.expectedBarcode;
    if (skuStale || barcodeStale) {
      await db.generationJobItem.update({ where: { id: item.id }, data: { status: "skipped_conflict", message: "The variant changed after the CSV dry-run. Reload and review the import again." } });
      continue;
    }
    active.push(item);
  }
  const rows: CsvVariantRow[] = active.map((item) => {
    const variant = current.get(item.variantId)!;
    return {
      variant_id: item.variantId,
      product_title: variant.productTitle,
      variant_title: variant.variantTitle,
      vendor: variant.vendor,
      sku: item.proposedSku ?? variant.sku ?? "",
      barcode: item.proposedBarcode ?? variant.barcode ?? "",
    };
  });
  const report = validateCsvImport(rows, all, {
    includeBarcodeOverwrites: (JSON.parse(job.fields) as string[]).includes("barcode_overwrite"),
  });
  for (const blocked of report.rows.filter((row) => row.verdict === "block")) {
    const details = blocked.issues.filter((entry) => entry.severity === "block").map((entry) => entry.message).join(" ");
    await db.generationJobItem.update({
      where: { jobId_variantId: { jobId: job.id, variantId: blocked.row.variant_id } },
      data: { status: "error", message: `CSV apply was stopped by write-time revalidation. ${details}` },
    });
  }
}

async function pointAssignment(
  catalog: ShopifyCatalog,
  base: string,
  ownerId: string,
  reservations = new DupIndex(),
): Promise<string> {
  const candidates = [base, ...Array.from({ length: 30 }, (_, index) => `${base}-${index + 2}`)];
  const hits = await catalog.findVariantsBySku(candidates);
  reservations.addBatch(hits.map((variant) => ({ variantId: variant.variantId, sku: variant.sku })));
  return assignUnique(base, reservations, { ownerId, maxSuffixAttempts: 30 }).sku;
}

async function planSingleAssignments(db: PrismaClient, catalog: ShopifyCatalog, job: GenerationJob): Promise<void> {
  const rule = await db.skuRuleSet.findUniqueOrThrow({ where: { id: job.ruleSetId } });
  const parsed = parsePattern(rule.pattern);
  if (!parsed.ok) throw new Error(parsed.errors[0]!.message);
  const config = parseRuleConfig(rule.config);
  const items = await db.generationJobItem.findMany({ where: { jobId: job.id, status: { not: "applied" } }, orderBy: { id: "asc" } });
  const variants = new Map((await catalog.getVariants(items.map((item) => item.variantId))).map((variant) => [variant.variantId, variant]));
  const start = await allocateStart(db, job.shopId, rule.id, items.length, parsed.ast);
  const reservations = new DupIndex();
  for (const [offset, item] of items.entries()) {
    const variant = variants.get(item.variantId);
    if (!variant) {
      await db.generationJobItem.update({ where: { id: item.id }, data: { status: "error", message: "Variant was not found." } });
      continue;
    }
    const base = render(parsed.ast, contextFor(variant), start + offset, config);
    const proposedSku = await pointAssignment(catalog, base, item.variantId, reservations);
    await db.generationJobItem.update({ where: { id: item.id }, data: { proposedSku } });
  }
}

async function runWrites(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  job: GenerationJob,
  options: RunGenerationOptions,
): Promise<void> {
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 250);
  const pendingItems = await db.generationJobItem.findMany({ where: { jobId: job.id, status: "planned" }, orderBy: { id: "asc" } });
  const batches = job.trigger === "csv"
    ? batchCsvWritesSwapSafe(pendingItems, batchSize)
    : Array.from({ length: Math.ceil(pendingItems.length / batchSize) }, (_, index) => pendingItems.slice(index * batchSize, (index + 1) * batchSize));
  let completedBatches = 0;
  let processed = 0;
  for (const candidateBatch of batches) {
    const freshJob = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (freshJob.status === "cancelled") return;
    const barcodeJob = generatesBarcode(job);
    const batch = candidateBatch.filter((item) =>
      job.trigger === "csv" ? item.proposedSku !== null || item.proposedBarcode !== null : (barcodeJob ? item.proposedBarcode : item.proposedSku),
    );
    if (job.trigger === "webhook" || job.trigger === "fix") {
      const reservations = new DupIndex();
      for (const item of batch) {
        const checked = await pointAssignment(catalog, item.proposedSku!, item.variantId, reservations);
        if (checked === item.proposedSku) continue;
        item.proposedSku = checked;
        await db.generationJobItem.update({ where: { id: item.id }, data: { proposedSku: checked } });
      }
    }
    const results = await catalog.updateVariants(batch.map((item) => {
      if (job.trigger === "csv") {
        return {
          variantId: item.variantId,
          ...(item.proposedSku === null ? {} : { sku: item.proposedSku, expectedSku: item.expectedSku }),
          ...(item.proposedBarcode === null ? {} : {
            barcode: item.proposedBarcode,
            expectedBarcode: item.expectedBarcode,
            allowBarcodeOverwrite: (JSON.parse(job.fields) as string[]).includes("barcode_overwrite"),
          }),
        };
      }
      return barcodeJob
        ? { variantId: item.variantId, barcode: item.proposedBarcode!, expectedBarcode: item.expectedBarcode }
        : { variantId: item.variantId, sku: item.proposedSku!, expectedSku: item.expectedSku };
    }));
    await db.$transaction(results.map((result) => db.generationJobItem.update({
      where: { jobId_variantId: { jobId: job.id, variantId: result.variantId } },
      data: { status: result.status, message: result.message ?? null },
    })));
    processed += batch.length;
    await db.generationJob.update({ where: { id: job.id }, data: { cursor: String(processed) } });
    await heartbeatJobLock(db, job.shopId, job.id);
    completedBatches += 1;
    if (options.crashAfterBatches === completedBatches) throw new SimulatedGenerationCrash();
  }
}

function batchCsvWritesSwapSafe<T extends {
  variantId: string;
  expectedSku: string | null;
  proposedSku: string | null;
  expectedBarcode: string | null;
  proposedBarcode: string | null;
}>(items: T[], batchSize: number): T[][] {
  const byId = new Map(items.map((item) => [item.variantId, item]));
  const adjacent = new Map<string, Set<string>>();
  for (const field of ["Sku", "Barcode"] as const) {
    const expectedKey = `expected${field}` as "expectedSku" | "expectedBarcode";
    const proposedKey = `proposed${field}` as "proposedSku" | "proposedBarcode";
    const byExpected = new Map(items.flatMap((item) => item[expectedKey] ? [[normalizeSku(item[expectedKey]!), item] as const] : []));
    for (const item of items) {
      const owner = item[proposedKey] ? byExpected.get(normalizeSku(item[proposedKey]!)) : undefined;
      if (!owner || owner.variantId === item.variantId) continue;
      const left = adjacent.get(item.variantId) ?? new Set<string>();
      const right = adjacent.get(owner.variantId) ?? new Set<string>();
      left.add(owner.variantId);
      right.add(item.variantId);
      adjacent.set(item.variantId, left);
      adjacent.set(owner.variantId, right);
    }
  }
  const seen = new Set<string>();
  const components: T[][] = [];
  const visit = (id: string, component: T[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    const item = byId.get(id);
    if (item) component.push(item);
    for (const next of adjacent.get(id) ?? []) visit(next, component);
  };
  for (const item of items) {
    if (seen.has(item.variantId)) continue;
    const component: T[] = [];
    visit(item.variantId, component);
    if (component.length > 250) throw new Error("A CSV swap cycle exceeds Shopify's safe 250-variant write batch limit.");
    components.push(component);
  }
  const batches: T[][] = [];
  let current: T[] = [];
  for (const component of components) {
    if (current.length && current.length + component.length > batchSize) {
      batches.push(current);
      current = [];
    }
    current.push(...component);
    if (current.length >= batchSize) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

async function calculateTotals(db: PrismaClient, jobId: string, verification?: { scanId: string; summary: { duplicateGroups: number; duplicateBarcodeGroups: number } }): Promise<GenerationTotals> {
  const items = await db.generationJobItem.findMany({ where: { jobId }, select: { status: true } });
  return {
    planned: items.length,
    applied: items.filter((item) => item.status === "applied").length,
    skippedConflict: items.filter((item) => item.status === "skipped_conflict").length,
    errored: items.filter((item) => item.status === "error").length,
    ...(verification ? {
      duplicateGroups: verification.summary.duplicateGroups,
      duplicateBarcodeGroups: verification.summary.duplicateBarcodeGroups,
      verificationScanId: verification.scanId,
    } : {}),
  };
}

export async function runGenerationJob(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  jobId: string,
  options: RunGenerationOptions = {},
): Promise<GenerationRunResult> {
  let job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  if (["completed", "completed_with_skips", "completed_with_findings"].includes(job.status)) return { job, queued: false };
  try {
    await acquireJobLock(db, { shopId: job.shopId, jobId: job.id, kind: job.trigger === "csv" ? "csv" : "generation", staleAfterMs: options.staleAfterMs });
  } catch (error) {
    if (error instanceof JobLockedError && (options.source === "webhook" || job.trigger === "webhook")) {
      await db.generationJob.update({ where: { id: job.id }, data: { status: "pending", error: null } });
      return { job: await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }), queued: true };
    }
    throw error;
  }

  let preserveCrashState = false;
  let verificationScanId: string | undefined;
  try {
    job = await db.generationJob.update({ where: { id: job.id }, data: { status: "running", error: null, finishedAt: null } });
    if (job.trigger === "csv") await refreshCsvAssignments(db, catalog, job);
    else if (generatesBarcode(job)) await refreshBarcodeAssignments(db, catalog, job);
    else if (job.trigger === "webhook" || job.trigger === "fix") await planSingleAssignments(db, catalog, job);
    else await refreshBulkAssignments(db, catalog, job);
    await runWrites(db, catalog, job, options);
    const cancelled = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (cancelled.status === "cancelled") return { job: cancelled, queued: false };
    const verification = await withCatalogBulkMutex(job.shopId, () => verifyGenerationRun({ db, catalog, shopId: job.shopId }));
    verificationScanId = verification.scanId;
    const totals = await calculateTotals(db, job.id, verification);
    const status = verification.summary.duplicateGroups + verification.summary.duplicateBarcodeGroups > 0
      ? "completed_with_findings"
      : totals.skippedConflict > 0 || totals.errored > 0
        ? "completed_with_skips"
        : "completed";
    job = await db.generationJob.update({ where: { id: job.id }, data: { status, totals: JSON.stringify(totals), finishedAt: new Date() } });
  } catch (error) {
    if (error instanceof SimulatedGenerationCrash) {
      preserveCrashState = true;
      throw error;
    }
    job = await db.generationJob.update({ where: { id: job.id }, data: { status: "failed", error: error instanceof Error ? error.message : "Generation failed.", finishedAt: new Date() } });
    throw error;
  } finally {
    if (!preserveCrashState) await releaseJobLock(db, job.shopId, job.id);
  }

  if (options.drainQueue ?? true) await drainPendingWebhookJobs(db, catalog, job.shopId);
  return { job, queued: false, verificationScanId };
}

export async function drainPendingWebhookJobs(db: PrismaClient, catalog: ShopifyCatalog, shopId: string): Promise<number> {
  let drained = 0;
  for (;;) {
    const next = await db.generationJob.findFirst({ where: { shopId, trigger: "webhook", status: "pending" }, orderBy: { createdAt: "asc" } });
    if (!next) return drained;
    const result = await runGenerationJob(db, catalog, next.id, { source: "webhook", drainQueue: false });
    if (result.queued) return drained;
    drained += 1;
  }
}

export async function cancelGenerationJob(db: PrismaClient, shopId: string, jobId: string): Promise<void> {
  await db.generationJob.updateMany({ where: { id: jobId, shopId, status: { in: ["pending", "previewing", "running"] } }, data: { status: "cancelled", finishedAt: new Date() } });
}

export async function getGenerationJob(db: PrismaClient, shopDomain: string, jobId: string) {
  const shop = await ensureShop(db, shopDomain);
  return db.generationJob.findFirstOrThrow({ where: { id: jobId, shopId: shop.id }, include: { items: { orderBy: { id: "asc" } } } });
}
