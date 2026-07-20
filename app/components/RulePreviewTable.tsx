import type { RulePreview } from "../services/preview.server";

export function RulePreviewTable({ preview }: { preview: RulePreview }) {
  return (
    <s-section heading="Live preview">
      <p><strong>Preview — nothing written.</strong> Collision results are sample-based; the apply plan performs the authoritative store-wide check.</p>
      <p>Sequence starts at {preview.sequenceStart}. Catalog sample: {preview.sampledCatalogSize} variants.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th align="left">Product</th><th align="left">Variant</th><th align="left">Current SKU</th><th align="left">Proposed SKU</th><th align="left">Status</th></tr></thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.variantId}>
                <td>{row.productTitle}</td><td>{row.variantTitle}</td><td>{row.currentSku ?? "—"}</td><td><code>{row.proposedSku ?? "—"}</code></td>
                <td>{row.error ? `Error: ${row.error}` : row.collision ? "Collision — sample-based" : "Available in sample"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </s-section>
  );
}
