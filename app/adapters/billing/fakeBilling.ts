import type { BillingPlan } from "../../core/constants";
import type { BillingGateway } from "./gateway";

const mockOverrides = new Map<string, BillingPlan>();

export class FakeBillingGateway implements BillingGateway {
  constructor(private readonly defaultPlan: BillingPlan = "free") {}

  async getPlan(shopDomain: string): Promise<BillingPlan> {
    return mockOverrides.get(shopDomain) ?? this.defaultPlan;
  }

  async requestUpgrade(shopDomain: string, plan: Exclude<BillingPlan, "free">): Promise<string> {
    return `/app/billing?mockUpgrade=${plan}&shop=${encodeURIComponent(shopDomain)}`;
  }

  switchPlan(shopDomain: string, plan: BillingPlan): void {
    mockOverrides.set(shopDomain, plan);
  }

  static clearOverrides(): void {
    mockOverrides.clear();
  }
}
