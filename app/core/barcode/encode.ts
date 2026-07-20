import {
  CODE128,
  CODE128_PATTERNS,
  codeForSet,
  isEncodableInSet,
  startForSet,
  valueInSet,
  type Code128Encoding,
  type CodeSet,
} from "./code128";

interface Path {
  codewords: number[];
  cSymbols: number;
}

function better(left: Path | undefined, right: Path): Path {
  if (!left) return right;
  if (right.codewords.length !== left.codewords.length) {
    return right.codewords.length < left.codewords.length ? right : left;
  }
  // On equal symbol counts, conventional auto encoders prefer Code C. This
  // gives denser bars even when the latch overhead makes the codeword count tie.
  return right.cSymbols > left.cSymbols ? right : left;
}

function numericPair(value: string, index: number): number | undefined {
  const pair = value.slice(index, index + 2);
  return /^\d{2}$/.test(pair) ? Number(pair) : undefined;
}

function digitRunLength(value: string, index: number): number {
  let end = index;
  while (end < value.length && /\d/.test(value[end]!)) end += 1;
  return end - index;
}

function encodeFrom(value: string, index: number, set: CodeSet, memo: Map<string, Path>): Path | undefined {
  if (index === value.length) return { codewords: [], cSymbols: 0 };
  const key = `${index}:${set}`;
  if (memo.has(key)) return memo.get(key);
  let best: Path | undefined;

  const append = (prefix: number[], nextSet: CodeSet, consumed: number, cSymbols: number) => {
    const tail = encodeFrom(value, index + consumed, nextSet, memo);
    if (!tail) return;
    best = better(best, { codewords: [...prefix, ...tail.codewords], cSymbols: cSymbols + tail.cSymbols });
  };

  if (set === "C") {
    const pair = numericPair(value, index);
    if (pair !== undefined) append([pair], "C", 2, 1);
  } else if (isEncodableInSet(value[index]!, set)) {
    append([valueInSet(value[index]!, set)], set, 1, 0);
  }

  for (const target of ["B", "A", "C"] as const) {
    if (target === set) continue;
    if (target === "C") {
      const pair = numericPair(value, index);
      if (pair !== undefined && digitRunLength(value, index) >= 4) {
        append([CODE128.codeC, pair], "C", 2, 1);
      }
    } else if (isEncodableInSet(value[index]!, target)) {
      append([codeForSet(target), valueInSet(value[index]!, target)], target, 1, 0);
    }
  }

  if (set !== "C") {
    const alternate = set === "A" ? "B" : "A";
    if (isEncodableInSet(value[index]!, alternate)) {
      append([CODE128.shift, valueInSet(value[index]!, alternate)], set, 1, 0);
    }
  }

  if (best) memo.set(key, best);
  return best;
}

export function checksumFor(codewordsWithoutChecksum: readonly number[]): number {
  if (codewordsWithoutChecksum.length === 0) throw new Error("A start code is required.");
  return codewordsWithoutChecksum.reduce(
    (sum, codeword, index) => sum + codeword * (index === 0 ? 1 : index),
    0,
  ) % 103;
}

export function encodeCode128(value: string): Code128Encoding {
  if (value.length === 0) throw new Error("Code 128 values cannot be empty.");
  for (const character of value) {
    if (character.charCodeAt(0) > 127) {
      throw new Error("Code 128 supports ASCII characters U+0000 through U+007F.");
    }
  }

  let best: Path | undefined;
  const leadingDigits = value.match(/^\d+/)?.[0].length ?? 0;
  const preferCStart = leadingDigits >= 4 || (leadingDigits === value.length && leadingDigits >= 2 && leadingDigits % 2 === 0);
  const startSets: CodeSet[] = preferCStart ? ["C", "B", "A"] : ["B", "A"];
  for (const set of startSets) {
    const tail = encodeFrom(value, 0, set, new Map());
    if (!tail) continue;
    const candidate = { codewords: [startForSet(set), ...tail.codewords], cSymbols: tail.cSymbols };
    if (!best || candidate.codewords.length < best.codewords.length) best = candidate;
    else if (candidate.codewords.length === best.codewords.length && set === "C" && preferCStart) best = candidate;
  }
  if (!best) throw new Error("The value cannot be represented as Code 128.");

  const checksum = checksumFor(best.codewords);
  const codewords = [...best.codewords, checksum, CODE128.stop];
  const modules = codewords.flatMap((codeword) =>
    [...CODE128_PATTERNS[codeword]!].map(Number),
  );
  const symbolWidth = modules.reduce((sum, width) => sum + width, 0);
  return {
    value,
    codewords,
    checksum,
    modules,
    symbolWidth,
    quietZone: CODE128.quietZone,
    totalWidth: symbolWidth + CODE128.quietZone * 2,
  };
}

export interface InternalBarcodeSettings {
  prefix: string;
  digits: number;
}

export const INTERNAL_BARCODE_HONESTY_COPY =
  "Internal Code 128 barcodes are for in-store and POS use. They are not GS1 UPC or EAN identifiers; Amazon and retail distribution require identifiers licensed through GS1.";

export function formatInternalBarcode(
  sequence: number,
  settings: InternalBarcodeSettings,
): string {
  if (!/^\d*$/.test(settings.prefix)) throw new Error("The internal barcode prefix must contain digits only.");
  if (!Number.isInteger(settings.digits) || settings.digits < 1 || settings.digits > 30) {
    throw new Error("Barcode digits must be an integer from 1 to 30.");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("The barcode sequence must be a non-negative safe integer.");
  const counter = String(sequence);
  if (counter.length > settings.digits) throw new Error("The barcode sequence exceeds the configured digit width.");
  return `${settings.prefix}${counter.padStart(settings.digits, "0")}`;
}
