import type { PrismaClient, Shop } from "@prisma/client";
import type { ShopifyCatalog } from "../adapters/shopify/catalog";
import { drainPendingWebhookJobs } from "./generation.server";
import { hasNightlyScanToday, runScan } from "./scan.server";

export interface NightlyScanResult {
  shopDomain: string;
  status: "completed" | "skipped_already_scanned" | "failed" | "timed_out";
  scanId?: string;
  error?: string;
  /** Webhook jobs left `pending` by a crash or a busy lock, recovered by this run. */
  drainedWebhookJobs?: number;
}

export async function runNightlyScans(options: {
  db: PrismaClient;
  now?: Date;
  shops?: Shop[];
  catalogForShop: (shopDomain: string) => Promise<ShopifyCatalog | null>;
  canScan?: (shop: Shop) => Promise<boolean>;
  perShopBudgetMs?: number;
}): Promise<NightlyScanResult[]> {
  const now = options.now ?? new Date();
  const shops = options.shops ?? await options.db.shop.findMany({
    where: { uninstalledAt: null },
    orderBy: { shopDomain: "asc" },
  });
  const results: NightlyScanResult[] = [];
  for (const shop of shops) {
    // Recover webhook jobs stranded in `pending` — the drain otherwise only runs
    // when some later job happens to execute in the same shop, so a crash (or a
    // lock that was busy when the webhook arrived) can strand them indefinitely.
    // This runs before the scan entitlement check because a stranded job is a
    // correctness problem regardless of whether the shop is due for a scan.
    const drainedWebhookJobs = await drainWebhookJobsForShop(options, shop);

    if (options.canScan && !(await options.canScan(shop))) {
      if (drainedWebhookJobs) {
        results.push({ shopDomain: shop.shopDomain, status: "skipped_already_scanned", drainedWebhookJobs });
      }
      continue;
    }
    if (await hasNightlyScanToday(options.db, shop.id, now)) {
      results.push({ shopDomain: shop.shopDomain, status: "skipped_already_scanned", drainedWebhookJobs });
      continue;
    }
    const catalog = await options.catalogForShop(shop.shopDomain);
    if (!catalog) {
      results.push({ shopDomain: shop.shopDomain, status: "failed", error: "Catalog session unavailable.", drainedWebhookJobs });
      continue;
    }
    const budgetMs = options.perShopBudgetMs ?? 15 * 60_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SCAN_TIME_BUDGET_EXCEEDED")), budgetMs);
      });
      const scan = await Promise.race([
        runScan({ db: options.db, catalog, shopDomain: shop.shopDomain, trigger: "nightly" }),
        timeout,
      ]);
      results.push({ shopDomain: shop.shopDomain, status: "completed", scanId: scan.id, drainedWebhookJobs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nightly scan failed.";
      results.push({
        shopDomain: shop.shopDomain,
        status: message === "SCAN_TIME_BUDGET_EXCEEDED" ? "timed_out" : "failed",
        error: message,
        drainedWebhookJobs,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return results;
}

/**
 * Drains this shop's stranded webhook generation jobs. Returns 0 (never throws)
 * when there is nothing to drain, no session, or the drain itself fails — a
 * recovery step must not be able to abort the nightly scan for every shop.
 */
async function drainWebhookJobsForShop(
  options: { db: PrismaClient; catalogForShop: (shopDomain: string) => Promise<ShopifyCatalog | null> },
  shop: Shop,
): Promise<number> {
  const pending = await options.db.generationJob.count({
    where: { shopId: shop.id, trigger: "webhook", status: "pending" },
  });
  if (pending === 0) return 0;
  try {
    const catalog = await options.catalogForShop(shop.shopDomain);
    if (!catalog) return 0;
    return await drainPendingWebhookJobs(options.db, catalog, shop.id);
  } catch {
    return 0;
  }
}
