import type { ParsedScanFinding } from "../services/scan.server";

const LABELS: Record<string, string> = {
  duplicate: "Duplicate SKU",
  duplicate_barcode: "Duplicate barcode",
  malformed: "Malformed SKU",
  missing_sku: "Missing SKU",
  missing_barcode: "Missing barcode",
};

interface FindingFixPreview {
  findingId: string;
  jobId: string;
  items: Array<{ variantId: string; proposedSku: string | null }>;
}

export function FindingCard({ finding, canFix, preview }: { finding: ParsedScanFinding; canFix: boolean; preview?: FindingFixPreview }) {
  const fixable = finding.kind === "duplicate" || finding.kind === "malformed";
  return (
    <article style={{ border: "1px solid #ddd", borderRadius: 8, marginBlock: 12, padding: 16 }}>
      <h3>{LABELS[finding.kind] ?? finding.kind}</h3>
      {finding.skuValue ? <p>Value: <code>{finding.skuValue}</code></p> : null}
      <ul>{finding.variants.map((variant) => (
        <li key={variant.variantId}>{variant.title || variant.variantId} — SKU: {variant.sku || "missing"}</li>
      ))}</ul>
      <div style={{ display: "flex", gap: 8 }}>
        {fixable && preview ? (
          <div>
            <p><strong>Proposed changes</strong></p>
            <ul>{preview.items.map((item) => <li key={item.variantId}>{item.variantId} to <code>{item.proposedSku ?? "unavailable"}</code></li>)}</ul>
            <form method="post">
              <input type="hidden" name="intent" value="fix" />
              <input type="hidden" name="findingId" value={finding.id} />
              <button type="submit">Confirm and apply</button>
              <span style={{ marginInlineStart: 8 }}><s-link href="/app/scan">Cancel</s-link></span>
            </form>
          </div>
        ) : fixable ? (
          <form method="post">
            <input type="hidden" name="intent" value="preview_fix" />
            <input type="hidden" name="findingId" value={finding.id} />
            <button type="submit" disabled={!canFix}>{canFix ? "Preview fix with default rule" : "Set a default rule to fix"}</button>
          </form>
        ) : null}
        <form method="post">
          <input type="hidden" name="intent" value="ignore" />
          <input type="hidden" name="findingId" value={finding.id} />
          <button type="submit">Ignore</button>
        </form>
      </div>
    </article>
  );
}
