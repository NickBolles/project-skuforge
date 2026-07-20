import { code128Svg } from "../core/barcode";
import type { LabelGeometry, LabelItem } from "../core/labels";

export function LabelPreview({ geometry, item }: { geometry: LabelGeometry; item: LabelItem }) {
  const ratio = geometry.labelWidthMm / geometry.labelHeightMm;
  const barcodeValue = item.barcode?.trim() || item.sku;
  return (
    <div
      aria-label={`${geometry.name} label preview`}
      style={{
        aspectRatio: String(ratio),
        border: "1px solid #999",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        maxWidth: 420,
        overflow: "hidden",
        padding: 8,
      }}
    >
      <span>{item.productName}</span>
      <div dangerouslySetInnerHTML={{ __html: code128Svg(barcodeValue, { includeText: false, height: 36 }) }} />
      <span>{item.sku}{item.price ? ` · ${item.price}` : ""}</span>
    </div>
  );
}

