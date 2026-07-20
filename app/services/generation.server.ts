import { Prisma, type GenerationJob, type PrismaClient } from "@prisma/client";
import type { CatalogVariant, ShopifyCatalog } from "../adapters/shopify/catalog";
import { parsePattern, render, type PatternAst } from "../core/sku";
import { assignUnique, DupIndex } from "../core/validate";
import { acquireJobLock, heartbeatJobLock, JobLockedError, releaseJobLock } from "./job-lock.server";
import { ensureShop, getRule, parseRuleConfig } from "./rules.server";
import { allocateSequenceBlock } from "./sequence.server";
import { verifyGenerationRun } from "./verification.server";

export type GenerationTrigger = "all_missing" | "selected" | "webhook" | "fix";

export interface GenerationTotals {
  planned: number;
  applied: number;
  skippedConflict: number;
  errored: number;
  duplicateGroups?: number;
  verificationScanId?: string;
}

export interface CreateGenerationInput {
  shopDomain: string;
  ruleSetId: string;
  trigger: "all_missing" | "selected";
  idempotencyKey: string;
  selectedVariantIds?: string[];
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

async function withBulkMutex<T>(shopId: string, task: () => Promise<T>): Promise<T> {
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
  data: { shopId: string; ruleSetId: string; trigger: GenerationTrigger; idempotencyKey: string },
): Promise<{ job: GenerationJob; created: boolean }> {
  try {
    const job = await db.generationJob.create({
      data: { ...data, fields: JSON.stringify(["sku"]), totals: JSON.stringify({ planned: 0, applied: 0, skippedConflict: 0, errored: 0 }) },
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
  return withBulkMutex(shopId, async () => {
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

export async function enqueueSingleVariantJob(
  db: PrismaClient,
  catalog: ShopifyCatalog,
  input: { shopDomain: string; ruleSetId: string; trigger: "webhook" | "fix"; idempotencyKey: string; variantIds: string[] },
) {
  const shop = await ensureShop(db, input.shopDomain);
  const rule = await getRule(db, input.shopDomain, input.ruleSetId);
  const record = await createJobRecord(db, { shopId: shop.id, ruleSetId: rule.id, trigger: input.trigger, idempotencyKey: input.idempotencyKey });
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
  const items = await db.generationJobItem.findMany({ where: { jobId: job.id, status: { not: "applied" } }, orderBy: { id: "asc" } });
  let completedBatches = 0;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const freshJob = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (freshJob.status === "cancelled") return;
    const batch = items.slice(offset, offset + batchSize).filter((item) => item.status !== "error" && item.proposedSku);
    if (job.trigger === "webhook" || job.trigger === "fix") {
      const reservations = new DupIndex();
      for (const item of batch) {
        const checked = await pointAssignment(catalog, item.proposedSku!, item.variantId, reservations);
        if (checked === item.proposedSku) continue;
        item.proposedSku = checked;
        await db.generationJobItem.update({ where: { id: item.id }, data: { proposedSku: checked } });
      }
    }
    const results = await catalog.updateVariants(batch.map((item) => ({ variantId: item.variantId, sku: item.proposedSku!, expectedSku: item.expectedSku })));
    await db.$transaction(results.map((result) => db.generationJobItem.update({
      where: { jobId_variantId: { jobId: job.id, variantId: result.variantId } },
      data: { status: result.status, message: result.message ?? null },
    })));
    await db.generationJob.update({ where: { id: job.id }, data: { cursor: String(offset + batch.length) } });
    await heartbeatJobLock(db, job.shopId, job.id);
    completedBatches += 1;
    if (options.crashAfterBatches === completedBatches) throw new SimulatedGenerationCrash();
  }
}

async function calculateTotals(db: PrismaClient, jobId: string, verification?: { scanId: string; summary: { duplicateGroups: number } }): Promise<GenerationTotals> {
  const items = await db.generationJobItem.findMany({ where: { jobId }, select: { status: true } });
  return {
    planned: items.length,
    applied: items.filter((item) => item.status === "applied").length,
    skippedConflict: items.filter((item) => item.status === "skipped_conflict").length,
    errored: items.filter((item) => item.status === "error").length,
    ...(verification ? { duplicateGroups: verification.summary.duplicateGroups, verificationScanId: verification.scanId } : {}),
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
    await acquireJobLock(db, { shopId: job.shopId, jobId: job.id, kind: "generation", staleAfterMs: options.staleAfterMs });
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
    if (job.trigger === "webhook" || job.trigger === "fix") await planSingleAssignments(db, catalog, job);
    else await refreshBulkAssignments(db, catalog, job);
    await runWrites(db, catalog, job, options);
    const cancelled = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (cancelled.status === "cancelled") return { job: cancelled, queued: false };
    const verification = await withBulkMutex(job.shopId, () => verifyGenerationRun({ db, catalog, shopId: job.shopId }));
    verificationScanId = verification.scanId;
    const totals = await calculateTotals(db, job.id, verification);
    const status = verification.summary.duplicateGroups > 0
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
