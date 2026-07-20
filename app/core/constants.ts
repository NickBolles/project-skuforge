export const BILLING_PLANS = ["free", "pro", "premium"] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const ENTITLEMENT_FEATURES = [
  "manual_generation",
  "auto_generation",
  "duplicate_scanning",
  "label_printing",
  "csv_workflows",
] as const;
export type EntitlementFeature = (typeof ENTITLEMENT_FEATURES)[number];

export const PLAN_PRICES: Record<Exclude<BillingPlan, "free">, number> = {
  pro: 12,
  premium: 19,
};

export const FREE_VARIANT_LIMIT = 50;

export const ENTITLEMENT_MATRIX: Record<BillingPlan, ReadonlySet<EntitlementFeature>> = {
  free: new Set(["manual_generation"]),
  pro: new Set(["manual_generation", "auto_generation", "duplicate_scanning"]),
  premium: new Set(["manual_generation", "auto_generation", "duplicate_scanning", "label_printing", "csv_workflows"]),
};

export function planHasFeature(plan: BillingPlan, feature: EntitlementFeature): boolean {
  return ENTITLEMENT_MATRIX[plan].has(feature);
}
