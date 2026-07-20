import smallCatalog from "../../test/fixtures/catalog-small.json";
import { FakeBillingGateway } from "../adapters/billing/fakeBilling";
import type { BillingGateway } from "../adapters/billing/gateway";
import { ShopifyBillingGateway } from "../adapters/billing/shopifyBilling";
import type { CatalogVariant, ShopifyCatalog } from "../adapters/shopify/catalog";
import { FixtureCatalog } from "../adapters/shopify/fixture-catalog.server";
import { GraphqlShopifyCatalog } from "../adapters/shopify/graphqlCatalog";
import { parseEnv } from "../config/env.server";
import db from "../db.server";
import { authenticate, MOCK_SHOP_DOMAIN } from "../shopify.server";

export interface AppSession {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  accessToken: string;
}

export interface AppContext {
  session: AppSession;
  catalog: ShopifyCatalog;
  billing: BillingGateway;
  db: typeof db;
  authMode: "shopify" | "mock";
}

let mockCatalog: FixtureCatalog | undefined;

export function getMockCatalog(): FixtureCatalog {
  mockCatalog ??= new FixtureCatalog(smallCatalog as CatalogVariant[]);
  return mockCatalog;
}

export async function getCatalogForShop(shopDomain: string, source: NodeJS.ProcessEnv = process.env): Promise<ShopifyCatalog | null> {
  const env = parseEnv(source);
  if (env.AUTH_MODE === "mock") return shopDomain === MOCK_SHOP_DOMAIN ? getMockCatalog() : null;
  const session = await db.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    orderBy: { expires: "desc" },
  });
  return session?.accessToken ? new GraphqlShopifyCatalog(shopDomain, session.accessToken) : null;
}

export async function getAppContext(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
): Promise<AppContext> {
  const env = parseEnv(source);

  if (env.AUTH_MODE === "mock") {
    const session: AppSession = {
      id: `offline_${MOCK_SHOP_DOMAIN}`,
      shop: MOCK_SHOP_DOMAIN,
      state: "mock",
      isOnline: false,
      accessToken: "mock-access-token-not-valid-for-shopify",
    };
    return {
      session,
      catalog: getMockCatalog(),
      billing: new FakeBillingGateway(env.MOCK_PLAN),
      db,
      authMode: "mock",
    };
  }

  const authenticated = await authenticate.admin(request);
  if (!("admin" in authenticated)) throw new Error("Shopify admin client unavailable outside mock mode.");
  const { session, admin } = authenticated;
  return {
    session: session as AppSession,
    catalog: new GraphqlShopifyCatalog(session.shop, session.accessToken!),
    billing: new ShopifyBillingGateway({
      client: {
        request: async (query, variables) => {
          const response = await admin.graphql(query, { variables });
          return response.json();
        },
      },
      getStoredPlan: async (shopDomain) => {
        const shop = await db.shop.upsert({ where: { shopDomain }, create: { shopDomain }, update: {} });
        return shop.plan === "pro" || shop.plan === "premium" ? shop.plan : "free";
      },
      appUrl: env.SHOPIFY_APP_URL,
      testCharges: env.BILLING_TEST,
    }),
    db,
    authMode: "shopify",
  };
}
