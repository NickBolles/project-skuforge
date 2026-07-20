import type { ActionFunctionArgs } from "react-router";
import { GraphqlShopifyCatalog } from "../adapters/shopify/graphqlCatalog";
import { parseEnv } from "../config/env.server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { getMockCatalog } from "../services/context.server";
import { handleProductsCreate } from "../services/products-create.server";
import { FakeBillingGateway } from "../adapters/billing/fakeBilling";
import { entitlementResponse } from "../services/entitlements.server";
import { ensureShop } from "../services/rules.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticate.webhook(request);
  const env = parseEnv();
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!webhookId) return Response.json({ error: "Missing webhook id." }, { status: 400 });
  const catalog = env.AUTH_MODE === "mock"
    ? getMockCatalog()
    : auth.session?.accessToken
      ? new GraphqlShopifyCatalog(auth.shop, auth.session.accessToken)
      : null;
  if (!catalog) return Response.json({ error: "Offline session unavailable." }, { status: 503 });
  const shop = await ensureShop(db, auth.shop);
  const plan = env.AUTH_MODE === "mock"
    ? await new FakeBillingGateway(env.MOCK_PLAN).getPlan(auth.shop)
    : shop.plan === "premium" || shop.plan === "pro" ? shop.plan : "free";
  try {
    const result = await handleProductsCreate({ db, catalog, shopDomain: auth.shop, webhookId, payload: auth.payload as never, plan });
    return Response.json(result, { status: result.queued ? 202 : 200 });
  } catch (error) {
    const response = entitlementResponse(error);
    if (response) return response;
    throw error;
  }
};
