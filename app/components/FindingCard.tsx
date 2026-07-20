import type { ParsedScanFinding } from "../services/scan.server";

const LABELS: Record<string, string> = {
  duplicate: "Duplicate SKU",
  duplicate_barcode: "Duplicate barcode",
  malformed: "Malformed SKU",
  missing_sku: "Missing SKU",
  missing_barcode: "Missing barcode",
};

export function FindingCard({ finding, canFix }: { finding: ParsedScanFinding; canFix: boolean }) {
  const fixable = finding.kind === "duplicate" || finding.kind === "malformed";
  return (
    <article style={{ border: "1px solid #ddd", borderRadius: 8, marginBlock: 12, padding: 16 }}>
      <h3>{LABELS[finding.kind] ?? finding.kind}</h3>
      {finding.skuValue ? <p>Value: <code>{finding.skuValue}</code></p> : null}
      <ul>{finding.variants.map((variant) => (
        <li key={variant.variantId}>{variant.title || variant.variantId} — SKU: {variant.sku || "missing"}</li>
      ))}</ul>
      <div style={{ display: "flex", gap: 8 }}>
        {fixable ? (
          <form method="post">
            <input type="hidden" name="intent" value="fix" />
            <input type="hidden" name="findingId" value={finding.id} />
            <button type="submit" disabled={!canFix}>{canFix ? "Fix with default rule" : "Set a default rule to fix"}</button>
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
