import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { drawCode128Barcode } from "./barcodeDraw";
import { labelRect, labelsPerPage, mmToPt, type LabelGeometry, type LabelRect } from "./geometry";

export interface LabelItem {
  sku: string;
  barcode?: string | null;
  productName?: string | null;
  price?: string | null;
}

export interface ComposeLabelOptions {
  startOffset?: number;
  copies?: number;
  includeProductName?: boolean;
  includePrice?: boolean;
  fontSize?: number;
}

export interface LabelDrawingSummary {
  itemIndex: number;
  pageIndex: number;
  slot: number;
  rect: LabelRect;
  barcodeRectCount: number;
  barcodeModuleCount: number;
  text: string[];
  warnings: string[];
}

export interface ComposeLabelsResult {
  bytes: Uint8Array;
  drawings: LabelDrawingSummary[];
  pageCount: number;
}

function ellipsize(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const suffix = "...";
  let end = text.length;
  while (end > 0 && font.widthOfTextAtSize(`${text.slice(0, end)}${suffix}`, size) > maxWidth) end -= 1;
  return `${text.slice(0, end)}${suffix}`;
}

function drawLabel(
  page: PDFPage,
  font: PDFFont,
  item: LabelItem,
  itemIndex: number,
  pageIndex: number,
  slot: number,
  rect: LabelRect,
  options: Required<Pick<ComposeLabelOptions, "includeProductName" | "includePrice" | "fontSize">>,
): LabelDrawingSummary {
  // Invisible cell boundary is intentional: it creates a structural PDF `re`
  // operator used by absolute-position regression tests without printing a line.
  page.drawRectangle({ ...rect, color: rgb(1, 1, 1), opacity: 0 });
  const padding = Math.min(mmToPt(2), rect.height * 0.1);
  const usableWidth = rect.width - padding * 2;
  const baseSize = Math.max(5, Math.min(options.fontSize, rect.height * 0.18));
  const text: string[] = [];
  const warnings: string[] = [];
  const sku = ellipsize(item.sku, font, baseSize, usableWidth * (options.includePrice && item.price ? 0.72 : 1));
  page.drawText(sku, { x: rect.x + padding, y: rect.y + padding, size: baseSize, font });
  text.push(sku);

  if (options.includePrice && item.price) {
    const price = ellipsize(item.price, font, baseSize, usableWidth * 0.28);
    const priceWidth = font.widthOfTextAtSize(price, baseSize);
    page.drawText(price, { x: rect.x + rect.width - padding - priceWidth, y: rect.y + padding, size: baseSize, font });
    text.push(price);
  }

  let titleReserve = 0;
  if (options.includeProductName && item.productName && rect.height >= mmToPt(18)) {
    const titleSize = Math.max(5, baseSize * 0.85);
    const title = ellipsize(item.productName, font, titleSize, usableWidth);
    page.drawText(title, { x: rect.x + padding, y: rect.y + rect.height - padding - titleSize, size: titleSize, font });
    text.push(title);
    titleReserve = titleSize + 2;
  }

  const barcodeY = rect.y + padding + baseSize + 2;
  const barcodeHeight = Math.max(5, rect.height - padding * 2 - baseSize - titleReserve - 4);
  const barcodeValue = item.barcode?.trim() || item.sku;
  const barcode = drawCode128Barcode(page, barcodeValue, {
    x: rect.x + padding,
    y: barcodeY,
    width: usableWidth,
    height: barcodeHeight,
  });
  if (barcode.clipped) {
    warnings.push(`Barcode ${barcodeValue} exceeds the printable width at the minimum module size.`);
  }
  return {
    itemIndex, pageIndex, slot, rect,
    barcodeRectCount: barcode.rectCount,
    barcodeModuleCount: barcode.moduleCount,
    text, warnings,
  };
}

export async function composeLabelsDetailed(
  geometry: LabelGeometry,
  items: readonly LabelItem[],
  options: ComposeLabelOptions = {},
): Promise<ComposeLabelsResult> {
  const startOffset = options.startOffset ?? 0;
  const copies = options.copies ?? 1;
  const capacity = labelsPerPage(geometry);
  if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset >= capacity) throw new RangeError(`Start offset must be from 0 to ${capacity - 1}.`);
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) throw new RangeError("Copies must be an integer from 1 to 100.");
  const expanded = items.flatMap((item, itemIndex) => Array.from({ length: copies }, () => ({ item, itemIndex })));
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${geometry.name} labels`);
  pdf.setProducer("SKUForge");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageCount = Math.ceil((startOffset + expanded.length) / capacity);
  const pages = Array.from({ length: pageCount }, () => pdf.addPage([mmToPt(geometry.pageWidthMm), mmToPt(geometry.pageHeightMm)]));
  const drawings: LabelDrawingSummary[] = [];
  const resolved = {
    includeProductName: options.includeProductName ?? true,
    includePrice: options.includePrice ?? true,
    fontSize: options.fontSize ?? 9,
  };
  for (const [index, entry] of expanded.entries()) {
    const absoluteSlot = startOffset + index;
    const pageIndex = Math.floor(absoluteSlot / capacity);
    const slot = absoluteSlot % capacity;
    drawings.push(drawLabel(pages[pageIndex]!, font, entry.item, entry.itemIndex, pageIndex, slot, labelRect(geometry, slot), resolved));
  }
  const warnings = drawings.flatMap((drawing) => drawing.warnings);
  if (warnings.length) pdf.setSubject([...new Set(warnings)].join(" | "));
  return { bytes: await pdf.save(), drawings, pageCount };
}

export async function composeLabels(
  geometry: LabelGeometry,
  items: readonly LabelItem[],
  options: ComposeLabelOptions = {},
): Promise<Uint8Array> {
  return (await composeLabelsDetailed(geometry, items, options)).bytes;
}

