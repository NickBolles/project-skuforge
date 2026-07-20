import smallCatalog from "../../test/fixtures/catalog-small.json";
import { FakeBillingGateway } from "../adapters/billing/gateway";
import type { BillingGateway } from "../adapters/billing/gateway";
import type { CatalogVariant, ShopifyCatalog } from "../adapters/shopify/catalog";
import { FixtureCatalog } from "../adapters/shopify/fixture-catalog.server";
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
      catalog: new FixtureCatalog(smallCatalog as CatalogVariant[]),
      billing: new FakeBillingGateway(env.MOCK_PLAN),
      db,
      authMode: "mock",
    };
  }

  const { session } = await authenticate.admin(request);
  throw new Error(
    `Authenticated ${session.shop}, but the live ShopifyCatalog adapter is introduced in Phase 3.`,
  );
}
