import { encodeCode128 } from "./encode";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

export function code128Svg(value: string, options: { height?: number; moduleWidth?: number; includeText?: boolean } = {}): string {
  const encoding = encodeCode128(value);
  const height = options.height ?? 48;
  const moduleWidth = options.moduleWidth ?? 1;
  const includeText = options.includeText ?? true;
  const textHeight = includeText ? 16 : 0;
  let cursor = encoding.quietZone;
  const rectangles: string[] = [];
  for (const [index, width] of encoding.modules.entries()) {
    if (index % 2 === 0) rectangles.push(`<rect x="${cursor * moduleWidth}" y="0" width="${width * moduleWidth}" height="${height}"/>`);
    cursor += width;
  }
  const totalWidth = encoding.totalWidth * moduleWidth;
  const text = includeText ? `<text x="${totalWidth / 2}" y="${height + 13}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="12">${escapeXml(value)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Code 128 barcode ${escapeXml(value)}" viewBox="0 0 ${totalWidth} ${height + textHeight}">${rectangles.join("")}${text}</svg>`;
}

