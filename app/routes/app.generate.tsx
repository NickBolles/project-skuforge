import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { code128Svg, formatInternalBarcode, INTERNAL_BARCODE_HONESTY_COPY } from "../core/barcode";
import { getAppContext } from "../services/context.server";
import { entitlementResponse, enforceVariantLimit } from "../services/entitlements.server";
import { createBulkBarcodeGenerationJob, createBulkGenerationJob, parseBarcodeSettings, saveBarcodeSettings } from "../services/generation.server";
import { ensureShop, listRules } from "../services/rules.server";
import { peekSequence } from "../services/sequence.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, db } = await getAppContext(request);
  const shop = await ensureShop(db, session.shop);
  const barcodeSettings = parseBarcodeSettings(shop.settings);
  const nextSequence = Math.max(await peekSequence(db, shop.id, "barcode"), barcodeSettings.startNumber);
  const nextBarcode = formatInternalBarcode(nextSequence, barcodeSettings);
  return {
    rules: await listRules(db, session.shop),
    barcodeSettings,
    nextBarcode,
    barcodePreview: code128Svg(nextBarcode),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, db, catalog, billing } = await getAppContext(request);
  const form = await request.formData();
  if (form.get("intent") === "save-barcode-settings") {
    await saveBarcodeSettings(db, session.shop, {
      prefix: String(form.get("prefix") ?? ""),
      digits: Number(form.get("digits")),
      startNumber: Number(form.get("startNumber")),
    });
    return redirect("/app/generate");
  }
  try {
    await enforceVariantLimit(billing, catalog, session.shop);
  } catch (error) {
    const response = entitlementResponse(error);
    if (response) return response;
    throw error;
  }
  const trigger = form.get("trigger") === "selected" ? "selected" : "all_missing";
  const common = {
    shopDomain: session.shop,
    trigger,
    idempotencyKey: String(form.get("idempotencyKey") ?? globalThis.crypto.randomUUID()),
    selectedVariantIds: String(form.get("variantIds") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  } as const;
  const job = form.get("field") === "barcode"
    ? await createBulkBarcodeGenerationJob(db, catalog, common)
    : await createBulkGenerationJob(db, catalog, { ...common, ruleSetId: String(form.get("ruleSetId") ?? "") });
  return redirect(`/app/generate/${job.id}`);
};

export default function GenerateRoute() {
  const { rules, barcodeSettings, nextBarcode, barcodePreview } = useLoaderData<typeof loader>();
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
      <s-section heading="Internal Code 128 barcodes">
        <p>{INTERNAL_BARCODE_HONESTY_COPY}</p>
        <p>Barcode fill only targets empty barcode fields. Existing UPC, EAN, and other merchant barcodes are never overwritten.</p>
        <form method="post">
          <input type="hidden" name="intent" value="save-barcode-settings" />
          <label>Numeric prefix<input name="prefix" inputMode="numeric" pattern="[0-9]*" defaultValue={barcodeSettings.prefix} /></label>
          <label>Counter digits<input name="digits" type="number" min="1" max="30" defaultValue={barcodeSettings.digits} required /></label>
          <label>Starting number<input name="startNumber" type="number" min="0" defaultValue={barcodeSettings.startNumber} required /></label>
          <button type="submit">Save barcode settings</button>
        </form>
        <p>Next barcode: {nextBarcode}</p>
        <div style={{ maxWidth: 480 }} dangerouslySetInnerHTML={{ __html: barcodePreview }} />
        <form method="post">
          <input type="hidden" name="field" value="barcode" />
          <input type="hidden" name="trigger" value="all_missing" />
          <button type="submit">Generate barcodes for variants missing them</button>
        </form>
      </s-section>
    </s-page>
  );
}
