import type { ActionFunctionArgs } from "react-router";
import { parseEnv } from "../config/env.server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../services/privacy.server";
import { verifyWebhookRequest } from "../services/webhook-security.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const env = parseEnv();
  const rawBody = await request.clone().text();
  if (!verifyWebhookRequest(request, rawBody, env)) return Response.json({ error: "Invalid webhook HMAC." }, { status: 401 });
  const { shop } = await authenticate.webhook(request);
  return Response.json(await purgeShopData(db, shop));
};
