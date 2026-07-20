import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { LabelPreview } from "../components/LabelPreview";
import { LABEL_TEMPLATES } from "../core/labels";
import { getAppContext } from "../services/context.server";
import { PlanGate } from "../components/PlanGate";
import { can } from "../services/entitlements.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { catalog, billing, session } = await getAppContext(request);
  const plan = await billing.getPlan(session.shop);
  if (!can(plan, "label_printing")) return { variants: [], templates: LABEL_TEMPLATES, plan, allowed: false };
  const page = await catalog.listVariantsPage({ pageSize: 50 });
  return { variants: page.variants, templates: LABEL_TEMPLATES, plan, allowed: true };
};

export default function LabelsRoute() {
  const { variants, templates, allowed } = useLoaderData<typeof loader>();
  const first = variants[0];
  return (
    <s-page heading="Print barcode labels">
      <PlanGate allowed={allowed} requiredPlan="premium"><s-section heading="Label options">
        <form method="post" action="/api/labels/pdf" target="_blank">
          <label>Template<select name="templateId" defaultValue="avery-5160">{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <label>Start offset<input type="number" name="startOffset" min="0" defaultValue="0" /></label>
          <label>Copies per variant<input type="number" name="copies" min="1" max="100" defaultValue="1" /></label>
          <label>Font size<input type="number" name="fontSize" min="5" max="18" defaultValue="9" /></label>
          <label><input type="checkbox" name="includeProductName" defaultChecked /> Product name</label>
          <label><input type="checkbox" name="includePrice" defaultChecked /> Price</label>
          <fieldset><legend>Variants</legend>{variants.map((variant) => <label key={variant.variantId}><input type="checkbox" name="variantIds" value={variant.variantId} /> {variant.productTitle} - {variant.variantTitle} ({variant.sku || "No SKU"})</label>)}</fieldset>
          <button type="submit">Download PDF</button>
        </form>
      </s-section></PlanGate>
      {first ? <s-section heading="Preview"><LabelPreview geometry={templates[0]} item={{ sku: first.sku || "NO-SKU", barcode: first.barcode, productName: first.productTitle, price: `$${first.price}` }} /></s-section> : null}
    </s-page>
  );
}
