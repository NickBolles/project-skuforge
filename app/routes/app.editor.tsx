import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { VariantGrid } from "../components/VariantGrid";
import { inlineEditVariant, listEditorPage, type InlineEditResult } from "../services/editor.server";
import { getAppContext } from "../services/context.server";
import { listRules } from "../services/rules.server";

function truthy(value: FormDataEntryValue | string | null): boolean {
  return value === "true" || value === "on" || value === "1";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, catalog, db, billing } = await getAppContext(request);
  const url = new URL(request.url);
  const page = await listEditorPage(db, catalog, session.shop, {
    cursor: url.searchParams.get("cursor") ?? undefined,
    duplicateOnly: truthy(url.searchParams.get("duplicates")),
    filter: {
      text: url.searchParams.get("q") || undefined,
      vendor: url.searchParams.get("vendor") || undefined,
      productType: url.searchParams.get("productType") || undefined,
      missingSku: truthy(url.searchParams.get("missingSku")),
      missingBarcode: truthy(url.searchParams.get("missingBarcode")),
    },
  });
  return {
    ...page,
    filters: Object.fromEntries([...url.searchParams].filter(([key]) => key !== "cursor")),
    plan: await billing.getPlan(session.shop),
    rules: (await listRules(db, session.shop)).filter((rule) => rule.active).map(({ id, name }) => ({ id, name })),
  };
};

export type EditorActionResult = InlineEditResult & { variantId: string; field: "sku" | "barcode" | null; newValue: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<EditorActionResult> => {
  const { catalog } = await getAppContext(request);
  const form = await request.formData();
  const variantId = String(form.get("variantId") ?? "");
  const newValue = String(form.get("newValue") ?? "");
  if (form.get("intent") !== "inline-edit") return { status: "error", message: "Unknown editor action.", variantId, field: null, newValue };
  const field = form.get("field");
  if (field !== "sku" && field !== "barcode") return { status: "error", message: "Editable field is invalid.", variantId, field: null, newValue };
  const result = await inlineEditVariant(catalog, {
    variantId,
    field,
    newValue,
    expectedValue: truthy(form.get("expectedWasNull")) ? null : String(form.get("expectedValue") ?? ""),
    allowDuplicate: truthy(form.get("allowDuplicate")),
    allowBarcodeOverwrite: truthy(form.get("allowBarcodeOverwrite")),
  });
  return { ...result, variantId, field, newValue };
};

function nextHref(filters: Record<string, string>, cursor: string | null): string {
  const params = new URLSearchParams(filters);
  if (cursor) params.set("cursor", cursor);
  else params.delete("cursor");
  return `/app/editor?${params.toString()}`;
}

export function EditorPage({ data, actionResult }: { data: Awaited<ReturnType<typeof loader>>; actionResult?: EditorActionResult }) {
  return (
    <s-page heading="Bulk editor">
      <s-section heading="Filters">
        <form method="get">
          <label>Search <input name="q" defaultValue={data.filters.q ?? ""} /></label>
          <label>Vendor <input name="vendor" defaultValue={data.filters.vendor ?? ""} /></label>
          <label>Product type <input name="productType" defaultValue={data.filters.productType ?? ""} /></label>
          <label><input type="checkbox" name="missingSku" defaultChecked={truthy(data.filters.missingSku ?? null)} /> Missing SKU</label>
          <label><input type="checkbox" name="missingBarcode" defaultChecked={truthy(data.filters.missingBarcode ?? null)} /> Missing barcode</label>
          <label><input type="checkbox" name="duplicates" defaultChecked={truthy(data.filters.duplicates ?? null)} /> Latest-scan duplicates only</label>
          <button type="submit">Apply filters</button>
        </form>
        <p>{data.totalVariants.toLocaleString()} catalog variants · {data.plan} plan. Free-plan awareness is informational in this phase.</p>
        <p><a href={`/api/csv/export?${new URLSearchParams(data.filters).toString()}`}>Export this filtered view as CSV</a> · <a href="/app/csv">Import CSV</a></p>
        {truthy(data.filters.duplicates ?? null) ? (
          data.duplicateScan
            ? <p>Duplicate results from {data.duplicateScan.finishedAt?.toISOString() ?? "the latest completed scan"}. <a href="/app/scan">Run a fresh scan</a>.</p>
            : <p>No completed duplicate scan is available. <a href="/app/scan">Run a scan</a>.</p>
        ) : null}
      </s-section>
      <s-section heading="Variants">
        <VariantGrid variants={data.variants} rules={data.rules} actionResult={actionResult} />
        {data.hasNext && data.cursor ? <a href={nextHref(data.filters, data.cursor)}>Next page</a> : null}
      </s-section>
    </s-page>
  );
}

export default function EditorRoute() {
  return <EditorPage data={useLoaderData<typeof loader>()} actionResult={useActionData<typeof action>()} />;
}
