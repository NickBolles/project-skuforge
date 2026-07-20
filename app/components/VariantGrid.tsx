import { useState } from "react";
import type { CatalogVariant } from "../adapters/shopify/catalog";
import type { InlineEditResult } from "../services/editor.server";
import { InlineSkuCell } from "./InlineSkuCell";

export interface VariantGridProps {
  variants: CatalogVariant[];
  rules: Array<{ id: string; name: string }>;
  actionResult?: InlineEditResult & { variantId: string; field: "sku" | "barcode" | null; newValue: string };
}

export function VariantGrid({ variants, rules, actionResult }: VariantGridProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = new Set(selected);
  const toggle = (variantId: string, checked: boolean) => {
    setSelected((current) => checked
      ? [...new Set([...current, variantId])]
      : current.filter((id) => id !== variantId));
  };
  return (
    <div>
      <s-table variant="auto">
        <s-table-header-row>
          <s-table-header listSlot="inline">Select</s-table-header>
          <s-table-header listSlot="primary">Variant</s-table-header>
          <s-table-header listSlot="secondary">Vendor / type</s-table-header>
          <s-table-header listSlot="labeled">SKU</s-table-header>
          <s-table-header listSlot="labeled">Barcode</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {variants.map((variant) => (
            <s-table-row key={variant.variantId}>
              <s-table-cell>
                <input
                  type="checkbox"
                  aria-label={`Select ${variant.productTitle} ${variant.variantTitle}`}
                  checked={selectedSet.has(variant.variantId)}
                  onChange={(event) => toggle(variant.variantId, event.currentTarget.checked)}
                />
              </s-table-cell>
              <s-table-cell><strong>{variant.productTitle}</strong><br />{variant.variantTitle}</s-table-cell>
              <s-table-cell>{variant.vendor}<br />{variant.productType}</s-table-cell>
              <s-table-cell><InlineSkuCell variantId={variant.variantId} field="sku" value={variant.sku} result={actionResult} /></s-table-cell>
              <s-table-cell><InlineSkuCell variantId={variant.variantId} field="barcode" value={variant.barcode} result={actionResult} /></s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
      <p>{selected.length} selected</p>
      <form method="post" action="/app/generate">
        <input type="hidden" name="trigger" value="selected" />
        <input type="hidden" name="variantIds" value={selected.join(",")} />
        <label>Rule <select name="ruleSetId" required>{rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label>
        <button type="submit" disabled={selected.length === 0 || rules.length === 0}>Generate for selected</button>
      </form>
      <form method="post" action="/api/labels/pdf" target="_blank">
        <input type="hidden" name="templateId" value="avery-5160" />
        <input type="hidden" name="includeProductName" value="on" />
        {selected.map((variantId) => <input key={variantId} type="hidden" name="variantIds" value={variantId} />)}
        <button type="submit" disabled={selected.length === 0}>Print labels</button>
      </form>
    </div>
  );
}
