import type { BillingPlan } from "../../core/constants";

export type { BillingPlan } from "../../core/constants";

export interface BillingGateway {
  getPlan(shopDomain: string): Promise<BillingPlan>;
  requestUpgrade(shopDomain: string, plan: Exclude<BillingPlan, "free">): Promise<string>;
}
