export type CodeSet = "A" | "B" | "C";

export const CODE128 = {
  shift: 98,
  codeC: 99,
  codeB: 100,
  codeA: 101,
  startA: 103,
  startB: 104,
  startC: 105,
  stop: 106,
  quietZone: 10,
} as const;

// ISO/IEC 15417 symbol patterns. Each digit is an alternating bar/space width.
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222",
  "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221",
  "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131",
  "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124",
  "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111",
  "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141",
  "411131", "211412", "211214", "211232", "2331112",
] as const;

export interface Code128Encoding {
  value: string;
  codewords: number[];
  checksum: number;
  modules: number[];
  symbolWidth: number;
  quietZone: number;
  totalWidth: number;
}

export function codeForSet(set: CodeSet): number {
  return set === "A" ? CODE128.codeA : set === "B" ? CODE128.codeB : CODE128.codeC;
}

export function startForSet(set: CodeSet): number {
  return set === "A" ? CODE128.startA : set === "B" ? CODE128.startB : CODE128.startC;
}

export function isEncodableInSet(character: string, set: "A" | "B"): boolean {
  const code = character.charCodeAt(0);
  return set === "A" ? code >= 0 && code <= 95 : code >= 32 && code <= 127;
}

export function valueInSet(character: string, set: "A" | "B"): number {
  if (!isEncodableInSet(character, set)) {
    throw new Error(`Character U+${character.charCodeAt(0).toString(16).padStart(4, "0")} is not encodable in Code Set ${set}.`);
  }
  const code = character.charCodeAt(0);
  return set === "A" ? (code < 32 ? code + 64 : code - 32) : code - 32;
}

