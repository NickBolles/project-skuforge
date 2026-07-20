import type { ActionFunctionArgs } from "react-router";
import { parseEnv } from "../config/env.server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { redactCustomerData } from "../services/privacy.server";
import { verifyWebhookRequest, webhookEventId } from "../services/webhook-security.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const env = parseEnv();
  const rawBody = await request.clone().text();
  if (!verifyWebhookRequest(request, rawBody, env)) return Response.json({ error: "Invalid webhook HMAC." }, { status: 401 });
  const { shop, topic } = await authenticate.webhook(request);
  const result = await redactCustomerData({ db, shopDomain: shop, webhookId: webhookEventId(request, topic, shop, rawBody) });
  return Response.json(result);
};
