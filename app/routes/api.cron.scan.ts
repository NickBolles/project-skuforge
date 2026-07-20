import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { parseEnv } from "../config/env.server";
import db from "../db.server";
import { getCatalogForShop } from "../services/context.server";
import { runNightlyScans } from "../services/cron-scan.server";
import { FakeBillingGateway } from "../adapters/billing/fakeBilling";
import { can } from "../services/entitlements.server";

export function authorizedCronRequest(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function handleCronScan(
  request: Request,
  options: { secret: string | undefined; run: () => Promise<unknown> },
): Promise<Response> {
  if (!options.secret) return Response.json({ error: "Cron is not configured." }, { status: 503 });
  if (!authorizedCronRequest(request, options.secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const results = await options.run();
  return Response.json({ date: new Date().toISOString().slice(0, 10), results });
}

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
