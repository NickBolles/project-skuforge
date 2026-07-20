import { PLAN_PRICES, type BillingPlan } from "../../core/constants";
import type { BillingGateway } from "./gateway";

export interface BillingGraphqlClient {
  request(query: string, variables: Record<string, unknown>): Promise<unknown>;
}

interface SubscriptionCreatePayload {
  data?: {
    appSubscriptionCreate?: {
      confirmationUrl?: string;
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
}

export const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation CreateSkuForgeSubscription($name: String!, $returnUrl: URL!, $test: Boolean!, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      confirmationUrl
      userErrors { field message }
    }
  }
`;

export class ShopifyBillingGateway implements BillingGateway {
  constructor(private readonly options: {
    client: BillingGraphqlClient;
    getStoredPlan: (shopDomain: string) => Promise<BillingPlan>;
    appUrl: string;
    testCharges?: boolean;
  }) {}

  getPlan(shopDomain: string): Promise<BillingPlan> {
    return this.options.getStoredPlan(shopDomain);
  }

  async requestUpgrade(shopDomain: string, plan: Exclude<BillingPlan, "free">): Promise<string> {
    const payload = await this.options.client.request(CREATE_SUBSCRIPTION_MUTATION, {
      name: `SKUForge ${plan === "pro" ? "Pro" : "Premium"}`,
      returnUrl: new URL("/app/billing?confirmed=1", this.options.appUrl).toString(),
      test: this.options.testCharges ?? false,
      lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: PLAN_PRICES[plan], currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } }],
    }) as SubscriptionCreatePayload;
    const result = payload.data?.appSubscriptionCreate;
    const errors = result?.userErrors ?? [];
    if (errors.length) throw new Error(`Shopify billing rejected the upgrade: ${errors.map((error) => error.message).join("; ")}`);
    if (!result?.confirmationUrl) throw new Error("Shopify billing did not return a confirmation URL.");
    return result.confirmationUrl;
  }
}
