import type { BarcodeWriteDecision, NormalizeSkuOptions } from "./types";

export function normalizeSku(
  value: string,
  options: NormalizeSkuOptions = {},
): string {
  const { trim = true, casing = "upper", unicodeForm = "NFC" } = options;
  let normalized = trim ? value.trim() : value;
  if (unicodeForm) normalized = normalized.normalize(unicodeForm);
  if (casing === "upper") return normalized.toUpperCase();
  if (casing === "lower") return normalized.toLowerCase();
  return normalized;
}

function present(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim() !== "";
}

/**
 * Shared guard for every barcode-writing path. Replacing a non-empty barcode
 * is blocked unless the caller has collected explicit overwrite consent.
 */
export function evaluateBarcodeWrite(
  current: string | null | undefined,
  proposed: string | null | undefined,
  options: { allowOverwrite?: boolean } = {},
): BarcodeWriteDecision {
  const currentValue = present(current) ? current!.trim() : "";
  const proposedValue = present(proposed) ? proposed!.trim() : "";
  if (currentValue === proposedValue) return "no_change";
  if (currentValue === "") return "allowed_empty";
  return options.allowOverwrite ? "allowed_overwrite" : "blocked_overwrite";
}

export function canWriteBarcode(
  current: string | null | undefined,
  proposed: string | null | undefined,
  options: { allowOverwrite?: boolean } = {},
): boolean {
  return (
    evaluateBarcodeWrite(current, proposed, options) !== "blocked_overwrite"
  );
}
