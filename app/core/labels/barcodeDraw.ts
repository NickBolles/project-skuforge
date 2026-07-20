import { rgb, type PDFPage } from "pdf-lib";
import { encodeCode128 } from "../barcode";

export const MIN_BARCODE_MODULE_WIDTH_PT = 0.5;

export interface BarcodeDrawResult {
  rectCount: number;
  moduleCount: number;
  moduleWidth: number;
  width: number;
  clipped: boolean;
}

export function drawCode128Barcode(
  page: PDFPage,
  value: string,
  rect: { x: number; y: number; width: number; height: number },
): BarcodeDrawResult {
  const encoded = encodeCode128(value);
  const fitted = rect.width / encoded.totalWidth;
  const moduleWidth = Math.max(MIN_BARCODE_MODULE_WIDTH_PT, Math.min(1, fitted));
  const drawnWidth = encoded.totalWidth * moduleWidth;
  const clipped = drawnWidth > rect.width + 0.01;
  let cursor = rect.x + encoded.quietZone * moduleWidth;
  let rectCount = 0;
  for (const [index, width] of encoded.modules.entries()) {
    const barWidth = width * moduleWidth;
    if (index % 2 === 0 && cursor < rect.x + rect.width) {
      page.drawRectangle({
        x: cursor,
        y: rect.y,
        width: Math.min(barWidth, rect.x + rect.width - cursor),
        height: rect.height,
        color: rgb(0, 0, 0),
      });
      rectCount += 1;
    }
    cursor += barWidth;
  }
  return { rectCount, moduleCount: encoded.modules.length, moduleWidth, width: drawnWidth, clipped };
}

