import type { ShopifyCatalog } from "../adapters/shopify/catalog";
import type { BillingGateway } from "../adapters/billing/gateway";
import { FREE_VARIANT_LIMIT, planHasFeature, type BillingPlan, type EntitlementFeature } from "../core/constants";

const FEATURE_NAMES: Record<EntitlementFeature, string> = {
  manual_generation: "manual SKU and barcode generation",
  auto_generation: "automatic generation for new products",
  duplicate_scanning: "duplicate scanning",
  label_printing: "label printing",
  csv_workflows: "CSV import and export",
};

export class EntitlementError extends Error {
  readonly status = 403;
  constructor(
    readonly feature: EntitlementFeature | "variant_limit",
    message: string,
    readonly requiredPlan: BillingPlan,
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

export function can(plan: BillingPlan, feature: EntitlementFeature): boolean {
  return planHasFeature(plan, feature);
}

export async function enforceEntitlement(
  billing: BillingGateway,
  shopDomain: string,
  feature: EntitlementFeature,
): Promise<BillingPlan> {
  const plan = await billing.getPlan(shopDomain);
  if (can(plan, feature)) return plan;
  const requiredPlan: BillingPlan = feature === "label_printing" || feature === "csv_workflows" ? "premium" : "pro";
  throw new EntitlementError(feature, `${FEATURE_NAMES[feature]} requires the ${requiredPlan} plan. Upgrade to continue.`, requiredPlan);
}

export async function enforceVariantLimit(
  billing: BillingGateway,
  catalog: ShopifyCatalog,
  shopDomain: string,
): Promise<void> {
  const plan = await billing.getPlan(shopDomain);
  if (plan !== "free") return;
  const count = await catalog.countVariants();
  if (count > FREE_VARIANT_LIMIT) {
    throw new EntitlementError("variant_limit", `Manual generation on the free plan supports stores with up to ${FREE_VARIANT_LIMIT} variants. This store has ${count}; upgrade to Pro to continue.`, "pro");
  }
}

export function entitlementResponse(error: unknown): Response | null {
  return error instanceof EntitlementError
    ? Response.json({ error: error.message, code: error.feature, requiredPlan: error.requiredPlan }, { status: error.status })
    : null;
}
