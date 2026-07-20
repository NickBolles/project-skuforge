export const BILLING_PLANS = ["free", "pro", "premium"] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export interface BillingGateway {
  getPlan(shopDomain: string): Promise<BillingPlan>;
  requestUpgrade(shopDomain: string, plan: Exclude<BillingPlan, "free">): Promise<string>;
}

export class FakeBillingGateway implements BillingGateway {
  constructor(private readonly plan: BillingPlan = "free") {}

  async getPlan(): Promise<BillingPlan> {
    return this.plan;
  }

  async requestUpgrade(
    shopDomain: string,
    plan: Exclude<BillingPlan, "free">,
  ): Promise<string> {
    return `/app?shop=${encodeURIComponent(shopDomain)}&mockUpgrade=${plan}`;
  }
}
