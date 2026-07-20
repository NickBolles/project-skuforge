import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { parseEnv } from "../config/env.server";
import { getAppContext } from "../services/context.server";
import { handleProductsCreate } from "../services/products-create.server";
import { entitlementResponse } from "../services/entitlements.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const env = parseEnv();
  if (env.AUTH_MODE !== "mock" || env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { session, db, catalog, billing } = await getAppContext(request);
  const payload = await request.json() as { webhookId?: string; variantIds?: string[] };
  const webhookId = payload.webhookId ?? `dev-${randomUUID()}`;
  try {
    const result = await handleProductsCreate({ db, catalog, shopDomain: session.shop, webhookId, payload: { variantIds: payload.variantIds ?? [] }, forceAutomation: true, plan: await billing.getPlan(session.shop) });
    return Response.json({ webhookId, ...result });
  } catch (error) {
    const response = entitlementResponse(error);
    if (response) return response;
    throw error;
  }
};
