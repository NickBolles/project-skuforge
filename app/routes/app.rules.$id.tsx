import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { RuleBuilder, type RuleBuilderValue } from "../components/RuleBuilder";
import { RulePreviewTable } from "../components/RulePreviewTable";
import { getAppContext } from "../services/context.server";
import { previewRule, type RulePreview } from "../services/preview.server";
import { deleteRule, getRule, parseRuleConfig, RuleValidationError, updateRule } from "../services/rules.server";

function inputFromForm(form: FormData) {
  return {
    name: String(form.get("name") ?? ""),
    pattern: String(form.get("pattern") ?? ""),
    config: String(form.get("config") ?? "{}"),
    isDefault: form.get("isDefault") === "on" || form.get("isDefault") === "true",
    active: form.get("active") === "on" || form.get("active") === "true",
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, db, catalog } = await getAppContext(request);
  const rule = await getRule(db, session.shop, params.id!);
  const config = parseRuleConfig(rule.config);
  return {
    rule: { ...rule, config },
    preview: await previewRule({ db, catalog, shopId: rule.shopId, ruleId: rule.id, pattern: rule.pattern, config }),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, db, catalog } = await getAppContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  if (intent === "delete") {
    await deleteRule(db, session.shop, params.id!);
    return redirect("/app/rules");
  }
  const input = inputFromForm(form);
  try {
    if (intent === "preview") {
      const current = await getRule(db, session.shop, params.id!);
      const config = parseRuleConfig(input.config);
      const preview = await previewRule({ db, catalog, shopId: current.shopId, ruleId: current.id, pattern: input.pattern, config });
      return { ok: true, preview };
    }
    await updateRule(db, session.shop, params.id!, input);
    return { ok: true, saved: true };
  } catch (error) {
    if (error instanceof RuleValidationError || error instanceof Error) {
      const patternError = error instanceof RuleValidationError ? error.patternErrors[0] : undefined;
      return Response.json({ ok: false, error: error.message, patternError }, { status: 422 });
    }
    throw error;
  }
};

interface RuleEditorPageProps {
  initial: RuleBuilderValue;
  preview: RulePreview;
  onPreview?: (value: RuleBuilderValue) => void;
  error?: string;
  patternError?: { message: string; position?: number } | null;
  saved?: boolean;
}

export function RuleEditorPage({ initial, preview, onPreview, error, patternError, saved }: RuleEditorPageProps) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (!onPreview) return;
    const timeout = window.setTimeout(() => onPreview(value), 350);
    return () => window.clearTimeout(timeout);
  }, [onPreview, value]);

  return (
    <s-page heading={`Edit rule: ${value.name}`}>
      <p><s-link href="/app/rules">← All rules</s-link></p>
      {error ? <p role="alert" style={{ color: "#b42318" }}>{error}</p> : null}
      {saved ? <p role="status">Rule saved.</p> : null}
      <form method="post">
        <RuleBuilder value={value} onChange={setValue} patternError={patternError} />
        <div style={{ display: "flex", gap: 8, marginBlock: 16 }}><button type="submit" name="intent" value="save">Save rule</button><button type="submit" name="intent" value="delete">Delete rule</button></div>
      </form>
      <RulePreviewTable preview={preview} />
    </s-page>
  );
}

export default function RuleEditorRoute() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const actionData = fetcher.data as { ok?: boolean; preview?: RulePreview; error?: string; patternError?: { message: string; position?: number }; saved?: boolean } | undefined;
  const initial: RuleBuilderValue = {
    name: data.rule.name,
    pattern: data.rule.pattern,
    config: data.rule.config,
    isDefault: data.rule.isDefault,
    active: data.rule.active,
  };
  const submitPreview = useCallback((value: RuleBuilderValue) => {
    const form = new FormData();
    form.set("intent", "preview");
    form.set("name", value.name);
    form.set("pattern", value.pattern);
    form.set("config", JSON.stringify(value.config));
    form.set("isDefault", String(value.isDefault));
    form.set("active", String(value.active));
    void fetcher.submit(form, { method: "post" });
  }, [fetcher]);
  return (
    <RuleEditorPage
      initial={initial}
      preview={actionData?.preview ?? data.preview}
      onPreview={submitPreview}
      error={actionData?.error}
      patternError={actionData?.patternError}
      saved={actionData?.saved}
    />
  );
}
