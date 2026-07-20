import type { BillingPlan } from "../core/constants";
import type React from "react";

export function PlanGate({ allowed, requiredPlan, children }: { allowed: boolean; requiredPlan: BillingPlan; children: React.ReactNode }) {
  if (allowed) return <>{children}</>;
  return (
    <section role="note" style={{ border: "1px solid #d6b656", borderRadius: 8, padding: 16 }}>
      <p>This action requires the {requiredPlan} plan.</p>
      <a href="/app/billing">View plans and upgrade</a>
    </section>
  );
}
