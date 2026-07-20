import type { InlineEditResult } from "../services/editor.server";

export interface InlineSkuCellProps {
  variantId: string;
  field: "sku" | "barcode";
  value: string | null;
  result?: InlineEditResult & { variantId: string; field: "sku" | "barcode" | null; newValue: string };
}

export function InlineSkuCell({ variantId, field, value, result: actionResult }: InlineSkuCellProps) {
  const result = actionResult?.variantId === variantId && actionResult.field === field ? actionResult : undefined;
  const warning = result?.status === "warning" ? result : null;
  const inputName = `${variantId}-${field}`;
  return (
    <div>
      <form method="post">
        <input type="hidden" name="intent" value="inline-edit" />
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="field" value={field} />
        <input type="hidden" name="expectedValue" value={value ?? ""} />
        <input type="hidden" name="expectedWasNull" value={value === null ? "true" : "false"} />
        <label htmlFor={inputName} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
          {field === "sku" ? "SKU" : "Barcode"}
        </label>
        <input id={inputName} name="newValue" defaultValue={value ?? ""} maxLength={255} />
        <button type="submit">Save</button>
      </form>
      {warning ? (
        <div role="alert">
          {warning.duplicateVariantIds.length > 0 ? (
            <p>This value already exists on {warning.duplicateVariantIds.length} other variant(s). Saving it creates a duplicate.</p>
          ) : null}
          {warning.barcodeOverwrite ? (
            <p>This field may contain an official UPC/EAN. Replacing a non-empty barcode requires explicit confirmation.</p>
          ) : null}
          <form method="post">
            <input type="hidden" name="intent" value="inline-edit" />
            <input type="hidden" name="variantId" value={variantId} />
            <input type="hidden" name="field" value={field} />
            <input type="hidden" name="newValue" value={warning.newValue} />
            <input type="hidden" name="expectedValue" value={value ?? ""} />
            <input type="hidden" name="expectedWasNull" value={value === null ? "true" : "false"} />
            <input type="hidden" name="allowDuplicate" value={warning.duplicateVariantIds.length > 0 ? "true" : "false"} />
            <input type="hidden" name="allowBarcodeOverwrite" value={warning.barcodeOverwrite ? "true" : "false"} />
            <button type="submit">Confirm edit</button>
          </form>
        </div>
      ) : null}
      {result?.status === "conflict" || result?.status === "error" ? <p role="alert">{result.message}</p> : null}
      {result?.status === "applied" ? <p role="status">Saved</p> : null}
    </div>
  );
}
