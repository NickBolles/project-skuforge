import type { ActionFunctionArgs } from "react-router";
import { parseEnv } from "../config/env.server";
import db from "../db.server";
import { getCatalogForShop } from "../services/context.server";
import { runNightlyScans } from "../services/cron-scan.server";
import { FakeBillingGateway } from "../adapters/billing/fakeBilling";
import { can } from "../services/entitlements.server";
import { handleCronScan } from "../services/cron.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const env = parseEnv();
  return handleCronScan(request, {
    secret: env.CRON_SECRET,
    run: () => runNightlyScans({
      db,
      catalogForShop: (shop) => getCatalogForShop(shop),
      canScan: async (shop) => {
        const plan = env.AUTH_MODE === "mock"
          ? await new FakeBillingGateway(env.MOCK_PLAN).getPlan(shop.shopDomain)
          : shop.plan === "pro" || shop.plan === "premium" ? shop.plan : "free";
        return can(plan, "duplicate_scanning");
      },
    }),
  });
};
