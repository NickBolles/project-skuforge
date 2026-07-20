import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { handleSubscriptionUpdate } from "../services/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const plan = await handleSubscriptionUpdate(db, shop, payload as never);
  return Response.json({ plan });
};
