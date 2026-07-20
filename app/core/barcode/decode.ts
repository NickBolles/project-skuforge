import { CODE128, CODE128_PATTERNS, type CodeSet } from "./code128";
import { checksumFor } from "./encode";

function characterFor(value: number, set: "A" | "B"): string {
  const code = set === "A" ? (value < 64 ? value + 32 : value - 64) : value + 32;
  return String.fromCharCode(code);
}

export function codewordsFromModules(modules: readonly number[]): number[] {
  const words: number[] = [];
  for (let offset = 0; offset < modules.length;) {
    const remaining = modules.length - offset;
    const widthCount = remaining === 7 ? 7 : 6;
    const pattern = modules.slice(offset, offset + widthCount).join("");
    const codeword = CODE128_PATTERNS.indexOf(pattern as never);
    if (codeword < 0) throw new Error(`Unknown Code 128 module pattern ${pattern}.`);
    words.push(codeword);
    offset += widthCount;
  }
  return words;
}

export function decodeCode128(modules: readonly number[]): string {
  const words = codewordsFromModules(modules);
  if (words.length < 3 || words.at(-1) !== CODE128.stop) throw new Error("Invalid Code 128 start/stop structure.");
  const start = words[0];
  let set: CodeSet = start === CODE128.startA ? "A" : start === CODE128.startB ? "B" : start === CODE128.startC ? "C" : (() => { throw new Error("Invalid Code 128 start code."); })();
  const expectedChecksum = words.at(-2)!;
  if (checksumFor(words.slice(0, -2)) !== expectedChecksum) throw new Error("Invalid Code 128 checksum.");

  let result = "";
  let shifted = false;
  for (const word of words.slice(1, -2)) {
    if (set === "C") {
      if (word === CODE128.codeA) { set = "A"; continue; }
      if (word === CODE128.codeB) { set = "B"; continue; }
      if (word > 99) throw new Error("Invalid data codeword in Code Set C.");
      result += String(word).padStart(2, "0");
      continue;
    }
    if (word === CODE128.shift) {
      shifted = true;
      continue;
    }
    if (word === CODE128.codeA) { set = "A"; continue; }
    if (word === CODE128.codeB) { set = "B"; continue; }
    if (word === CODE128.codeC) { set = "C"; continue; }
    const active = shifted ? (set === "A" ? "B" : "A") : set;
    result += characterFor(word, active);
    shifted = false;
  }
  if (shifted) throw new Error("Dangling Code 128 shift code.");
  return result;
}
