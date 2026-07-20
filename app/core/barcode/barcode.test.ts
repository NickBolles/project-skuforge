// bwip-js uses TypeScript `export =` declarations behind an ESM export map;
// the import plugin cannot infer its synthetic default although TypeScript can.
// eslint-disable-next-line import/default
import bwipjs from "bwip-js/node";
import { describe, expect, it } from "vitest";
import {
  CODE128,
  code128Svg,
  decodeCode128,
  encodeCode128,
  formatInternalBarcode,
} from ".";

// eslint-disable-next-line import/no-named-as-default-member -- see import note above
const { raw: bwipRaw } = bwipjs;

function oracleModules(value: string): number[] {
  // bwip-js wraps a stateful PostScript VM. Vitest's concurrent full-suite
  // workers can very occasionally observe an empty raw stack, so retry the
  // same deterministic oracle call rather than weakening the comparison.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const encoded = bwipRaw({ bcid: "code128", text: value });
    const first = encoded[0];
    if (first && "sbs" in first) return first.sbs;
  }
  throw new Error(`bwip-js did not return linear-barcode data for ${JSON.stringify(value)}.`);
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
}

describe("Code 128", () => {
  it("encodes known Code 128 vectors with checksum and stop", () => {
    expect(encodeCode128("123456").codewords).toEqual([105, 12, 34, 56, 44, 106]);
    expect(encodeCode128("Wikipedia").checksum).toBe(88);
    expect(encodeCode128("AB").modules.at(-1)).toBe(2);
  });

  it("compacts numeric runs in Code Set C and mixes odd numeric input", () => {
    expect(encodeCode128("0011223344").codewords[0]).toBe(CODE128.startC);
    const mixed = encodeCode128("12345");
    expect(mixed.codewords.some((word) => word === CODE128.startC || word === CODE128.codeC)).toBe(true);
    expect(decodeCode128(mixed.modules)).toBe("12345");
  });

  it("round-trips 1,000 seeded ASCII strings", () => {
    const next = random(0x5c0f0a6e);
    for (let sample = 0; sample < 1_000; sample += 1) {
      const length = 1 + Math.floor(next() * 36);
      let value = "";
      for (let index = 0; index < length; index += 1) {
        value += String.fromCharCode(Math.floor(next() * 128));
      }
      expect(decodeCode128(encodeCode128(value).modules)).toBe(value);
    }
  });

  it("matches bwip-js raw module widths for 200 seeded values", () => {
    const next = random(0x1280face);
    for (let sample = 0; sample < 200; sample += 1) {
      const length = 1 + Math.floor(next() * 28);
      let value = "";
      for (let index = 0; index < length; index += 1) {
        const digitHeavy = next() < 0.55;
        value += digitHeavy
          ? String(Math.floor(next() * 10))
          : String.fromCharCode(32 + Math.floor(next() * 95));
      }
      expect(encodeCode128(value).modules, value).toEqual(oracleModules(value));
    }
  });

  it("formats numeric internal values and rejects invalid settings", () => {
    expect(formatInternalBarcode(42, { prefix: "88", digits: 6 })).toBe("88000042");
    expect(() => formatInternalBarcode(1, { prefix: "ABC", digits: 6 })).toThrow(/digits only/);
  });

  it("renders vector-only SVG with quiet zones", () => {
    const svg = code128Svg("SKU-0001", { includeText: false });
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<image");
    expect(svg).toContain('viewBox="0 0 ');
  });
});
