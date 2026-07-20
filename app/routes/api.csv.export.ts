import type { LoaderFunctionArgs } from "react-router";
import { getAppContext } from "../services/context.server";
import { streamEditorCsv } from "../services/csv.server";
import { entitlementResponse, enforceEntitlement } from "../services/entitlements.server";

function checked(value: string | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, catalog, db, billing } = await getAppContext(request);
  try {
    await enforceEntitlement(billing, session.shop, "csv_workflows");
  } catch (error) {
    const response = entitlementResponse(error);
    if (response) return response;
    throw error;
  }
  const params = new URL(request.url).searchParams;
  const stream = streamEditorCsv({
    db,
    catalog,
    shopDomain: session.shop,
    duplicateOnly: checked(params.get("duplicates")),
    filter: {
      text: params.get("q") || undefined,
      vendor: params.get("vendor") || undefined,
      productType: params.get("productType") || undefined,
      missingSku: checked(params.get("missingSku")),
      missingBarcode: checked(params.get("missingBarcode")),
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="skuforge-variants-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
