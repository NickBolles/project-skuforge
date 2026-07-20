import { Prisma, type PrismaClient } from "@prisma/client";
import type { ShopifyCatalog } from "../adapters/shopify/catalog";
import { enqueueSingleVariantJob, runGenerationJob } from "./generation.server";
import { ensureShop } from "./rules.server";
import { can, EntitlementError } from "./entitlements.server";
import type { BillingPlan } from "../core/constants";

interface ProductWebhookPayload {
  id?: string | number;
  admin_graphql_api_id?: string;
  variants?: Array<{ id?: string | number; admin_graphql_api_id?: string }>;
  variantIds?: string[];
}

function variantIds(payload: ProductWebhookPayload): string[] {
  if (payload.variantIds) return payload.variantIds;
  return (payload.variants ?? []).flatMap((variant) => {
    if (variant.admin_graphql_api_id) return [variant.admin_graphql_api_id];
    if (variant.id !== undefined) return [`gid://shopify/ProductVariant/${variant.id}`];
    return [];
  });
}

export async function handleProductsCreate(options: {
  db: PrismaClient;
  catalog: ShopifyCatalog;
  shopDomain: string;
  webhookId: string;
  payload: ProductWebhookPayload;
  forceAutomation?: boolean;
  plan: BillingPlan;
}) {
  if (options.forceAutomation && !can(options.plan, "auto_generation")) {
    throw new EntitlementError("auto_generation", "Automatic generation for new products requires the pro plan. Upgrade to continue.", "pro");
  }
  const shop = await ensureShop(options.db, options.shopDomain);
  try {
    await options.db.webhookEvent.create({
      data: { id: options.webhookId, shopId: shop.id, topic: "PRODUCTS_CREATE", payload: JSON.stringify(options.payload) },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { deduped: true, jobId: null, queued: false };
    }
    throw error;
  }

  if (!can(options.plan, "auto_generation")) {
    await options.db.webhookEvent.update({ where: { id: options.webhookId }, data: { status: "ignored_plan" } });
    return { deduped: false, jobId: null, queued: false, ignored: true, reason: "plan" as const };
  }

  const settings = JSON.parse(shop.settings) as { autoGenerateOnCreate?: boolean };
  if (!options.forceAutomation && !settings.autoGenerateOnCreate) {
    await options.db.webhookEvent.update({ where: { id: options.webhookId }, data: { status: "ignored" } });
    return { deduped: false, jobId: null, queued: false };
  }
  const rule = await options.db.skuRuleSet.findFirst({ where: { shopId: shop.id, isDefault: true, active: true } });
  if (!rule) {
    await options.db.webhookEvent.update({ where: { id: options.webhookId }, data: { status: "ignored_no_default_rule" } });
    return { deduped: false, jobId: null, queued: false };
  }
  const job = await enqueueSingleVariantJob(options.db, options.catalog, {
    shopDomain: options.shopDomain,
    ruleSetId: rule.id,
    trigger: "webhook",
    idempotencyKey: `wh:${options.webhookId}`,
    variantIds: variantIds(options.payload),
  });
  const run = await runGenerationJob(options.db, options.catalog, job.id, { source: "webhook" });
  await options.db.webhookEvent.update({ where: { id: options.webhookId }, data: { status: run.queued ? "queued" : "processed" } });
  return { deduped: false, jobId: job.id, queued: run.queued };
}
