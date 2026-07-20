import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { FakeBillingGateway } from "../adapters/billing/fakeBilling";
import { BILLING_PLANS, PLAN_PRICES, type BillingPlan } from "../core/constants";
import { getAppContext } from "../services/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, authMode } = await getAppContext(request);
  return { plan: await billing.getPlan(session.shop), authMode };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, authMode } = await getAppContext(request);
  const form = await request.formData();
  const requested = String(form.get("plan") ?? "");
  if (!BILLING_PLANS.includes(requested as BillingPlan)) return Response.json({ error: "Unknown billing plan." }, { status: 400 });
  const plan = requested as BillingPlan;
  if (authMode === "mock") {
    if (!(billing instanceof FakeBillingGateway)) throw new Error("Mock billing gateway unavailable.");
    billing.switchPlan(session.shop, plan);
    return redirect("/app/billing");
  }
  if (plan === "free") return Response.json({ error: "Cancel the current subscription from Shopify billing." }, { status: 400 });
  return redirect(await billing.requestUpgrade(session.shop, plan));
};

export default function BillingRoute() {
  const { plan, authMode } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Plans and billing">
      <s-section heading={`Current plan: ${plan}`}>
        <p>Free: up to 50 variants with manual generation.</p>
        <p>Pro: ${PLAN_PRICES.pro}/month — unlimited variants, automatic generation, and duplicate scanning.</p>
        <p>Premium: ${PLAN_PRICES.premium}/month — adds label printing and CSV workflows.</p>
        <form method="post">
          <label>Plan<select name="plan" defaultValue={plan}>{BILLING_PLANS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
          <button type="submit">{authMode === "mock" ? "Switch mock plan" : "Continue to Shopify approval"}</button>
        </form>
      </s-section>
    </s-page>
  );
}
