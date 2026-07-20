import { Prisma, type PrismaClient } from "@prisma/client";
import { ensureShop } from "./rules.server";
import { logEvent } from "./log.server";

export async function recordCustomerDataRequest(options: {
  db: PrismaClient;
  shopDomain: string;
  webhookId: string;
}) {
  const shop = await ensureShop(options.db, options.shopDomain);
  try {
    await options.db.webhookEvent.create({
      data: {
        id: options.webhookId,
        shopId: shop.id,
        topic: "CUSTOMERS_DATA_REQUEST",
        payload: JSON.stringify({ customerDataStored: false }),
        status: "completed_no_customer_data",
      },
    });
    return { deduped: false, customerDataStored: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { deduped: true, customerDataStored: false };
    }
    throw error;
  }
}

export async function redactCustomerData(options: {
  db: PrismaClient;
  shopDomain: string;
  webhookId: string;
}) {
  const shop = await ensureShop(options.db, options.shopDomain);
  try {
    await options.db.webhookEvent.create({
      data: {
        id: options.webhookId,
        shopId: shop.id,
        topic: "CUSTOMERS_REDACT",
        payload: JSON.stringify({ customerDataStored: false }),
        status: "completed_no_customer_data",
      },
    });
    return { deduped: false, recordsDeleted: 0 };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { deduped: true, recordsDeleted: 0 };
    }
    throw error;
  }
}

export async function cleanupUninstalledShop(db: PrismaClient, shopDomain: string) {
  const shop = await ensureShop(db, shopDomain);
  const now = new Date();
  const [sessions, locks, jobs] = await db.$transaction([
    db.session.deleteMany({ where: { shop: shopDomain } }),
    db.jobLock.deleteMany({ where: { shopId: shop.id } }),
    db.generationJob.updateMany({
      where: { shopId: shop.id, status: { in: ["pending", "previewing", "running"] } },
      data: { status: "cancelled", error: "App uninstalled.", finishedAt: now },
    }),
    db.skuRuleSet.updateMany({ where: { shopId: shop.id, active: true }, data: { active: false } }),
    db.shop.update({ where: { id: shop.id }, data: { uninstalledAt: now } }),
  ]);
  logEvent("info", "app_uninstalled_cleanup", { shopDomain, sessionsDeleted: sessions.count, locksDeleted: locks.count, jobsCancelled: jobs.count });
  return { sessionsDeleted: sessions.count, locksDeleted: locks.count, jobsCancelled: jobs.count };
}

export async function purgeShopData(db: PrismaClient, shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    await db.session.deleteMany({ where: { shop: shopDomain } });
    return { alreadyPurged: true };
  }
  const scans = await db.duplicateScan.findMany({ where: { shopId: shop.id }, select: { id: true } });
  const jobs = await db.generationJob.findMany({ where: { shopId: shop.id }, select: { id: true } });
  await db.$transaction([
    db.scanFinding.deleteMany({ where: { scanId: { in: scans.map((scan) => scan.id) } } }),
    db.generationJobItem.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } }),
    db.jobLock.deleteMany({ where: { shopId: shop.id } }),
    db.webhookEvent.deleteMany({ where: { shopId: shop.id } }),
    db.labelTemplate.deleteMany({ where: { shopId: shop.id } }),
    db.sequenceCounter.deleteMany({ where: { shopId: shop.id } }),
    db.skuRuleSet.deleteMany({ where: { shopId: shop.id } }),
    db.duplicateScan.deleteMany({ where: { shopId: shop.id } }),
    db.generationJob.deleteMany({ where: { shopId: shop.id } }),
    db.session.deleteMany({ where: { shop: shopDomain } }),
    db.shop.delete({ where: { id: shop.id } }),
  ]);
  logEvent("info", "shop_data_redacted", { shopDomain });
  return { alreadyPurged: false };
}
