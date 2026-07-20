import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../config/env.server";

export function verifyShopifyWebhookHmac(rawBody: string, suppliedHmac: string | null, secret: string): boolean {
  if (!suppliedHmac || !secret) return false;
  const supplied = Buffer.from(suppliedHmac, "base64");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyWebhookRequest(request: Request, rawBody: string, env: AppEnv): boolean {
  if (env.AUTH_MODE === "mock") return env.NODE_ENV !== "production";
  return verifyShopifyWebhookHmac(rawBody, request.headers.get("x-shopify-hmac-sha256"), env.SHOPIFY_API_SECRET ?? "");
}

export function webhookEventId(request: Request, topic: string, shop: string, rawBody: string): string {
  return request.headers.get("x-shopify-webhook-id")
    ?? `derived:${createHash("sha256").update(`${topic}\n${shop}\n${rawBody}`).digest("hex")}`;
}
