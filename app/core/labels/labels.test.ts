import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  LABEL_TEMPLATES,
  composeLabelsDetailed,
  getLabelTemplate,
  labelRect,
  labelsPerPage,
  mmToPt,
} from ".";

const item = {
  sku: "SKU-0001",
  barcode: "88000001",
  productName: "A practical product name",
  price: "$12.00",
};

function closeTo(actual: number, expected: number, tolerance = 0.5) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function decodedPageOperators(document: PDFDocument, pageIndex: number): string {
  const contents = document.getPages()[pageIndex]!.node.Contents();
  if (!contents) return "";
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream))
    : [contents as PDFRawStream];
  return streams.map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
}

function rectangles(operators: string): Array<{ x: number; y: number; width: number; height: number }> {
  const result: Array<{ x: number; y: number; width: number; height: number }> = [];
  const number = "(-?\\d+(?:\\.\\d+)?)";
  const expression = new RegExp(
    `1 0 0 1 ${number} ${number} cm\\s+1 0 0 1 0 0 cm\\s+1 0 0 1 0 0 cm\\s+0 0 m\\s+0 ${number} l\\s+${number} ${number} l\\s+${number} 0 l`,
    "g",
  );
  for (const match of operators.matchAll(expression)) {
    result.push({ x: Number(match[1]), y: Number(match[2]), width: Number(match[4]), height: Number(match[3]) });
  }
  return result;
}

describe("label geometry and PDF composition", () => {
  it.each(LABEL_TEMPLATES.map((template) => [template.id, template] as const))(
    "%s writes absolute first, middle, and last label origins into PDF operators",
    async (_id, template) => {
      const capacity = labelsPerPage(template);
      const result = await composeLabelsDetailed(template, Array.from({ length: capacity }, () => item));
      const document = await PDFDocument.load(result.bytes);
      const operators = decodedPageOperators(document, 0);
      const markers = rectangles(operators).filter((rect) =>
        Math.abs(rect.width - mmToPt(template.labelWidthMm)) < 0.01 &&
        Math.abs(rect.height - mmToPt(template.labelHeightMm)) < 0.01,
      );
      expect(markers).toHaveLength(capacity);
      for (const slot of new Set([0, Math.floor(capacity / 2), capacity - 1])) {
        const expected = labelRect(template, slot);
        closeTo(markers[slot]!.x, expected.x);
        closeTo(markers[slot]!.y, expected.y);
        closeTo(markers[slot]!.width, expected.width);
        closeTo(markers[slot]!.height, expected.height);
      }
    },
  );

  it("uses correct page-count math for Avery and thermal labels", async () => {
    const items = Array.from({ length: 37 }, (_, index) => ({ ...item, sku: `SKU-${index}` }));
    expect((await composeLabelsDetailed(getLabelTemplate("avery-5160"), items)).pageCount).toBe(2);
    expect((await composeLabelsDetailed(getLabelTemplate("dymo-30334"), items)).pageCount).toBe(37);
  });

  it.each(LABEL_TEMPLATES.map((template) => [template.id, template] as const))(
    "%s reopens with the specified page dimensions",
    async (_id, template) => {
      const result = await composeLabelsDetailed(template, [item]);
      const document = await PDFDocument.load(result.bytes);
      const size = document.getPage(0).getSize();
      closeTo(size.width, mmToPt(template.pageWidthMm));
      closeTo(size.height, mmToPt(template.pageHeightMm));
    },
  );

  it("places the first item at a partially-used-sheet start offset", async () => {
    const template = getLabelTemplate("avery-5160");
    const result = await composeLabelsDetailed(template, [item], { startOffset: 7 });
    expect(result.drawings[0]!.slot).toBe(7);
    expect(result.drawings[0]!.rect).toEqual(labelRect(template, 7));
    const document = await PDFDocument.load(result.bytes);
    const expected = labelRect(template, 7);
    const marker = rectangles(decodedPageOperators(document, 0)).find((rect) =>
      Math.abs(rect.width - expected.width) < 0.01 && Math.abs(rect.height - expected.height) < 0.01,
    );
    expect(marker).toBeDefined();
    closeTo(marker!.x, expected.x);
    closeTo(marker!.y, expected.y);
  });

  it("composes DYMO 30252 in landscape along its 89 mm axis", async () => {
    const template = getLabelTemplate("dymo-30252");
    const result = await composeLabelsDetailed(template, [item]);
    const size = (await PDFDocument.load(result.bytes)).getPage(0).getSize();
    expect(template.orientation).toBe("landscape");
    expect(size.width).toBeGreaterThan(size.height);
    closeTo(size.width, mmToPt(89));
    closeTo(size.height, mmToPt(28.6));
  });

  it("draws one vector rectangle for every encoded bar run", async () => {
    const result = await composeLabelsDetailed(getLabelTemplate("dymo-30334"), [item]);
    const drawing = result.drawings[0]!;
    expect(drawing.barcodeRectCount).toBe(Math.ceil(drawing.barcodeModuleCount / 2));
    expect(rectangles(decodedPageOperators(await PDFDocument.load(result.bytes), 0)).length).toBeGreaterThan(drawing.barcodeRectCount);
  });

  it("ellipsizes long product titles and produces a stable drawing summary", async () => {
    const result = await composeLabelsDetailed(getLabelTemplate("avery-5160"), [{
      ...item,
      productName: "An exceptionally long product title that cannot fit on a compact label without truncation",
    }]);
    expect(result.drawings[0]!.text.some((value) => value.endsWith("..."))).toBe(true);
    expect({
      pageCount: result.pageCount,
      slot: result.drawings[0]!.slot,
      textCount: result.drawings[0]!.text.length,
      warnings: result.drawings[0]!.warnings,
    }).toMatchInlineSnapshot(`
      {
        "pageCount": 1,
        "slot": 0,
        "textCount": 3,
        "warnings": [],
      }
    `);
  });
});
