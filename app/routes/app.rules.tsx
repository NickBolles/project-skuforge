import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getAppContext } from "../services/context.server";
import { createRule, deleteRule, listRules, RuleValidationError } from "../services/rules.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, db } = await getAppContext(request);
  return { rules: await listRules(db, session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, db } = await getAppContext(request);
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    await deleteRule(db, session.shop, String(form.get("ruleId") ?? ""));
    return { ok: true };
  }
  try {
    const rule = await createRule(db, session.shop, {
      name: String(form.get("name") ?? ""),
      pattern: String(form.get("pattern") ?? ""),
      config: String(form.get("config") ?? "{}"),
      isDefault: form.get("isDefault") === "on",
      active: true,
    });
    return redirect(`/app/rules/${rule.id}`);
  } catch (error) {
    if (error instanceof RuleValidationError) {
      return Response.json({ ok: false, error: error.message }, { status: 422 });
    }
    throw error;
  }
};

export interface RulesPageProps {
  rules: Array<{ id: string; name: string; pattern: string; isDefault: boolean; active: boolean }>;
}

export function RulesPage({ rules }: RulesPageProps) {
  return (
    <s-page heading="SKU rules">
      <s-section heading="Create a rule">
        <form method="post" style={{ display: "grid", gap: 12, maxWidth: 720 }}>
          <label>Rule name<input name="name" defaultValue="Primary SKU rule" required /></label>
          <label>Pattern<input name="pattern" defaultValue="{vendor:3}-{product-type:3}-{option:Size}-{seq:4}" required style={{ width: "100%" }} /></label>
          <input type="hidden" name="config" value={JSON.stringify({ casing: "upper", stripNonAlphanumeric: true, missingValuePolicy: "skip-token", abbreviations: {}, scope: { vendors: [], productTypes: [], tags: [] } })} />
          <label><input type="checkbox" name="isDefault" /> Make this the default rule</label>
          <button type="submit">Create rule</button>
        </form>
      </s-section>
      <s-section heading="Saved rules">
        {rules.length === 0 ? <p>No rules yet.</p> : (
          <ul>{rules.map((rule) => <li key={rule.id}><s-link href={`/app/rules/${rule.id}`}>{rule.name}</s-link> — <code>{rule.pattern}</code>{rule.isDefault ? " — Default" : ""}{!rule.active ? " — Inactive" : ""}</li>)}</ul>
        )}
      </s-section>
    </s-page>
  );
}

export default function RulesRoute() {
  return <RulesPage rules={useLoaderData<typeof loader>().rules} />;
}
