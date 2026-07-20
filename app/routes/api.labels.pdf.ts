import type { ActionFunctionArgs } from "react-router";
import { createLabelsPdf } from "../services/labels.server";
import { getAppContext } from "../services/context.server";

function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { catalog } = await getAppContext(request);
  const form = await request.formData();
  const bytes = await createLabelsPdf(catalog, {
    templateId: String(form.get("templateId") ?? "avery-5160"),
    variantIds: form.getAll("variantIds").map(String),
    startOffset: Number(form.get("startOffset") ?? 0),
    copies: Number(form.get("copies") ?? 1),
    fontSize: Number(form.get("fontSize") ?? 9),
    includeProductName: checked(form, "includeProductName"),
    includePrice: checked(form, "includePrice"),
  });
  const body = Uint8Array.from(bytes).buffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="skuforge-labels-${Date.now()}.pdf"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
};
