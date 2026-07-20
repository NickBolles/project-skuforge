import type { PrismaClient, Shop } from "@prisma/client";
import type { ShopifyCatalog } from "../adapters/shopify/catalog";
import { hasNightlyScanToday, runScan } from "./scan.server";

export interface NightlyScanResult {
  shopDomain: string;
  status: "completed" | "skipped_already_scanned" | "failed" | "timed_out";
  scanId?: string;
  error?: string;
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
    if (options.canScan && !(await options.canScan(shop))) continue;
    if (await hasNightlyScanToday(options.db, shop.id, now)) {
      results.push({ shopDomain: shop.shopDomain, status: "skipped_already_scanned" });
      continue;
    }
    const catalog = await options.catalogForShop(shop.shopDomain);
    if (!catalog) {
      results.push({ shopDomain: shop.shopDomain, status: "failed", error: "Catalog session unavailable." });
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
      results.push({ shopDomain: shop.shopDomain, status: "completed", scanId: scan.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nightly scan failed.";
      results.push({
        shopDomain: shop.shopDomain,
        status: message === "SCAN_TIME_BUDGET_EXCEEDED" ? "timed_out" : "failed",
        error: message,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return results;
}
