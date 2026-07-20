import type { SkuTokenKind } from "./types";

export const TEXT_TOKEN_NAMES = [
  "prefix",
  "vendor",
  "product-type",
  "category",
  "title",
] as const;

export const TOKEN_REFERENCE = [
  { syntax: "{prefix}", description: "Configured literal prefix" },
  { syntax: "{vendor[:N]}", description: "Vendor, optionally truncated" },
  {
    syntax: "{product-type[:N]} / {category[:N]}",
    description: "Product type, optionally truncated",
  },
  { syntax: "{title[:N]}", description: "Product title, optionally truncated" },
  {
    syntax: "{option:Name[:N]}",
    description: "Named variant option, optionally truncated",
  },
  { syntax: "{seq[:N]}", description: "Sequence with optional zero-padding" },
] as const;

export function canonicalTokenKind(name: string): SkuTokenKind | undefined {
  if (name === "category") return "product-type";
  if (
    name === "prefix" ||
    name === "vendor" ||
    name === "product-type" ||
    name === "title" ||
    name === "option" ||
    name === "seq"
  ) {
    return name;
  }
  return undefined;
}

export function isPositiveWidth(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}
