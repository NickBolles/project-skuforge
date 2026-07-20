import type { PrismaClient, ScanFinding as PersistedFinding } from "@prisma/client";
import type { ShopifyCatalog } from "../adapters/shopify/catalog";
import { parsePattern, patternToRegex } from "../core/sku";
import { scanCatalog, type ScanSummary, type ScanVariantRef } from "../core/validate";
import { enqueueSingleVariantJob, prepareSingleVariantJob, runGenerationJob, withCatalogBulkMutex } from "./generation.server";
import { ensureShop, parseRuleConfig } from "./rules.server";

export type ScanTrigger = "manual" | "nightly" | "post_generation";

export interface ParsedScanFinding extends Omit<PersistedFinding, "variants"> {
  variants: ScanVariantRef[];
}

export interface ScanWithFindings {
  id: string;
  shopId: string;
  trigger: string;
  status: string;
  totals: string;
  startedAt: Date;
  finishedAt: Date | null;
  findings: ParsedScanFinding[];
  summary: ScanSummary;
}

const EMPTY_SUMMARY: ScanSummary = {
  variantsScanned: 0,
  duplicateGroups: 0,
  duplicateVariants: 0,
  duplicateBarcodeGroups: 0,
  duplicateBarcodeVariants: 0,
  malformed: 0,
  missingSku: 0,
  missingBarcode: 0,
};

export function parseScanSummary(value: string): ScanSummary {
  try {
    return { ...EMPTY_SUMMARY, ...(JSON.parse(value) as Partial<ScanSummary>) };
  } catch {
    return { ...EMPTY_SUMMARY };
  }
}

function parseFinding(finding: PersistedFinding): ParsedScanFinding {
  return {
    ...finding,
    variants: JSON.parse(finding.variants) as ScanVariantRef[],
  };
}

export async function runScan(options: {
  db: PrismaClient;
  catalog: ShopifyCatalog;
  shopDomain: string;
  trigger: ScanTrigger;
  skuPattern?: RegExp;
}) {
  const shop = await ensureShop(options.db, options.shopDomain);
  const defaultRule = options.skuPattern
    ? null
    : await options.db.skuRuleSet.findFirst({
      where: { shopId: shop.id, isDefault: true, active: true },
      select: { pattern: true, config: true },
    });
  let skuPattern = options.skuPattern;
  if (!skuPattern && defaultRule) {
    const parsed = parsePattern(defaultRule.pattern);
    if (!parsed.ok) throw new Error(parsed.errors[0]!.message);
    skuPattern = patternToRegex(parsed.ast, parseRuleConfig(defaultRule.config));
  }
  const scan = await options.db.duplicateScan.create({
    data: { shopId: shop.id, trigger: options.trigger, status: "running" },
  });
  try {
    const result = await withCatalogBulkMutex(shop.id, () =>
      scanCatalog(options.catalog.streamAllVariants({ batchSize: 250 }), {
        skuPattern,
        includeDuplicateBarcodes: true,
      }),
    );
    if (result.findings.length) {
      await options.db.scanFinding.createMany({
        data: result.findings.map((finding) => ({
          scanId: scan.id,
          kind: finding.kind,
          skuValue:
            "normalizedValue" in finding
              ? finding.normalizedValue
              : "value" in finding
                ? finding.value
                : null,
          variants: JSON.stringify(finding.variants),
        })),
      });
    }
    const completed = await options.db.duplicateScan.update({
      where: { id: scan.id },
      data: {
        status: "completed",
        totals: JSON.stringify(result.summary),
        finishedAt: new Date(),
      },
      include: { findings: { orderBy: [{ kind: "asc" }, { id: "asc" }] } },
    });
    return {
      ...completed,
      findings: completed.findings.map(parseFinding),
      summary: result.summary,
    };
  } catch (error) {
    await options.db.duplicateScan.update({
      where: { id: scan.id },
      data: { status: "failed", finishedAt: new Date() },
    });
    throw error;
  }
}

export async function getLatestScan(db: PrismaClient, shopDomain: string): Promise<ScanWithFindings | null> {
  const shop = await ensureShop(db, shopDomain);
  const scan = await db.duplicateScan.findFirst({
    where: { shopId: shop.id, status: "completed" },
    orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
    include: { findings: { where: { resolution: "open" }, orderBy: [{ kind: "asc" }, { id: "asc" }] } },
  });
  if (!scan) return null;
  return {
    ...scan,
    findings: scan.findings.map(parseFinding),
    summary: parseScanSummary(scan.totals),
  };
}

export async function ignoreFinding(db: PrismaClient, shopDomain: string, findingId: string): Promise<void> {
  const shop = await ensureShop(db, shopDomain);
  const finding = await db.scanFinding.findFirst({
    where: { id: findingId, scan: { shopId: shop.id } },
  });
  if (!finding) throw new Error("Scan finding was not found.");
  await db.scanFinding.update({
    where: { id: finding.id },
    data: { resolution: "ignored", resolvedAt: new Date() },
  });
}

export async function previewFindingFix(options: {
  db: PrismaClient;
  catalog: ShopifyCatalog;
  shopDomain: string;
  findingId: string;
}) {
  const shop = await ensureShop(options.db, options.shopDomain);
  const finding = await options.db.scanFinding.findFirst({
    where: { id: options.findingId, resolution: "open", scan: { shopId: shop.id } },
  });
  if (!finding) throw new Error("Open scan finding was not found.");
  if (!['duplicate', 'malformed'].includes(finding.kind)) {
    throw new Error("Only duplicate or malformed SKU findings can be fixed automatically.");
  }
  const rule = await options.db.skuRuleSet.findFirst({
    where: { shopId: shop.id, isDefault: true, active: true },
  });
  if (!rule) throw new Error("Set an active default SKU rule before fixing findings.");
  const variants = JSON.parse(finding.variants) as ScanVariantRef[];
  const targets = finding.kind === "duplicate" ? variants.slice(1) : variants;
  if (!targets.length) throw new Error("The finding has no repairable variants.");
  const job = await enqueueSingleVariantJob(options.db, options.catalog, {
    shopDomain: options.shopDomain,
    ruleSetId: rule.id,
    trigger: "fix",
    idempotencyKey: `fix:${finding.id}`,
    variantIds: targets.map((variant) => variant.variantId),
  });
  return prepareSingleVariantJob(options.db, options.catalog, job.id);
}

export async function fixFinding(options: {
  db: PrismaClient;
  catalog: ShopifyCatalog;
  shopDomain: string;
  findingId: string;
}) {
  const job = await previewFindingFix(options);
  const run = await runGenerationJob(options.db, options.catalog, job.id, { source: "ui" });
  const items = await options.db.generationJobItem.findMany({ where: { jobId: job.id }, select: { status: true } });
  if (items.length > 0 && items.every((item) => item.status === "applied")) {
    await options.db.scanFinding.updateMany({
      where: { id: options.findingId, resolution: "open" },
      data: { resolution: "fixed", resolvedAt: new Date() },
    });
  }
  return run;
}

export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function hasNightlyScanToday(db: PrismaClient, shopId: string, now = new Date()): Promise<boolean> {
  return (await db.duplicateScan.count({
    where: { shopId, trigger: "nightly", startedAt: { gte: utcDayStart(now) } },
  })) > 0;
}
