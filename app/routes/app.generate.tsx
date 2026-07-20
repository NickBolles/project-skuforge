import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getAppContext } from "../services/context.server";
import { createBulkGenerationJob } from "../services/generation.server";
import { listRules } from "../services/rules.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, db } = await getAppContext(request);
  return { rules: await listRules(db, session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, db, catalog } = await getAppContext(request);
  const form = await request.formData();
  const trigger = form.get("trigger") === "selected" ? "selected" : "all_missing";
  const job = await createBulkGenerationJob(db, catalog, {
    shopDomain: session.shop,
    ruleSetId: String(form.get("ruleSetId") ?? ""),
    trigger,
    idempotencyKey: String(form.get("idempotencyKey") ?? randomUUID()),
    selectedVariantIds: String(form.get("variantIds") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  });
  return redirect(`/app/generate/${job.id}`);
};

export default function GenerateRoute() {
  const { rules } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Generate SKUs">
      <s-section heading="Apply to variants missing SKUs">
        <p>This creates a collision-safe preview first. Nothing is written until you confirm.</p>
        <form method="post">
          <input type="hidden" name="trigger" value="all_missing" />
          <label>Rule<select name="ruleSetId" required>{rules.filter((rule) => rule.active).map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label>
          <button type="submit" disabled={rules.length === 0}>Build preview</button>
        </form>
      </s-section>
      <s-section heading="Selected variants">
        <form method="post"><input type="hidden" name="trigger" value="selected" /><label>Rule<select name="ruleSetId">{rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label><label>Variant IDs (comma separated)<textarea name="variantIds" /></label><button type="submit">Build selected preview</button></form>
      </s-section>
    </s-page>
  );
}
