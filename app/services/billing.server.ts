import type { PrismaClient } from "@prisma/client";
import type { BillingPlan } from "../core/constants";
import { ensureShop } from "./rules.server";

interface SubscriptionWebhookPayload {
  status?: string;
  name?: string;
  app_subscription?: { status?: string; name?: string };
}

export function planFromSubscription(payload: SubscriptionWebhookPayload): BillingPlan {
  const subscription = payload.app_subscription ?? payload;
  const status = subscription.status?.toUpperCase();
  if (status && !["ACTIVE", "ACCEPTED"].includes(status)) return "free";
  const name = subscription.name?.toLowerCase() ?? "";
  if (name.includes("premium")) return "premium";
  if (name.includes("pro")) return "pro";
  return "free";
}

export async function handleSubscriptionUpdate(
  db: PrismaClient,
  shopDomain: string,
  payload: SubscriptionWebhookPayload,
): Promise<BillingPlan> {
  const shop = await ensureShop(db, shopDomain);
  const plan = planFromSubscription(payload);
  await db.shop.update({ where: { id: shop.id }, data: { plan, planUpdatedAt: new Date() } });
  return plan;
}
