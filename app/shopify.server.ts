import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { parseEnv } from "./config/env.server";
import prisma from "./db.server";

export const MOCK_SHOP_DOMAIN = "dev-shop.myshopify.test";

export function assertAuthConfiguration(source: NodeJS.ProcessEnv = process.env) {
  return parseEnv(source);
}

const env = assertAuthConfiguration();
const liveShopify =
  env.AUTH_MODE === "shopify"
    ? shopifyApp({
        apiKey: env.SHOPIFY_API_KEY!,
        apiSecretKey: env.SHOPIFY_API_SECRET!,
        apiVersion: ApiVersion.October25,
        scopes: env.SCOPES.split(","),
        appUrl: env.SHOPIFY_APP_URL,
        authPathPrefix: "/auth",
        sessionStorage: new PrismaSessionStorage(prisma),
        distribution: AppDistribution.AppStore,
        future: { expiringOfflineAccessTokens: true },
        ...(env.SHOP_CUSTOM_DOMAIN
          ? { customShopDomains: [env.SHOP_CUSTOM_DOMAIN] }
          : {}),
      })
    : null;

const mockSession = {
  id: `offline_${MOCK_SHOP_DOMAIN}`,
  shop: MOCK_SHOP_DOMAIN,
  state: "mock",
  isOnline: false,
  accessToken: "mock-access-token-not-valid-for-shopify",
};

const mockAuthenticate = {
  async admin() {
    return { session: mockSession };
  },
  async webhook(request: Request) {
    console.warn("Mock auth accepted a webhook without HMAC verification (non-production only). ");
    let payload: Record<string, unknown> = {};
    try {
      payload = (await request.clone().json()) as Record<string, unknown>;
    } catch {
      // Empty mock webhooks are valid for route smoke tests.
    }
    return {
      payload,
      session: null,
      topic: request.headers.get("x-shopify-topic") ?? "MOCK",
      shop: MOCK_SHOP_DOMAIN,
    };
  },
};

export default liveShopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = liveShopify
  ? liveShopify.addDocumentResponseHeaders
  : () => undefined;
export const authenticate = liveShopify?.authenticate ?? mockAuthenticate;
export const unauthenticated = liveShopify?.unauthenticated;
export const login = liveShopify?.login ?? (async () => ({}));
export const registerWebhooks = liveShopify?.registerWebhooks;
export const sessionStorage = liveShopify?.sessionStorage;
