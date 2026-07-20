import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { parseEnv } from "../config/env.server";
import { getAppContext } from "../services/context.server";
import { handleProductsCreate } from "../services/products-create.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const env = parseEnv();
  if (env.AUTH_MODE !== "mock" || env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { session, db, catalog } = await getAppContext(request);
  const payload = await request.json() as { webhookId?: string; variantIds?: string[] };
  const webhookId = payload.webhookId ?? `dev-${randomUUID()}`;
  const result = await handleProductsCreate({ db, catalog, shopDomain: session.shop, webhookId, payload: { variantIds: payload.variantIds ?? [] }, forceAutomation: true });
  return Response.json({ webhookId, ...result });
};
