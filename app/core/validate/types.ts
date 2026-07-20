export interface NormalizeSkuOptions {
  trim?: boolean;
  casing?: "upper" | "lower" | "asis";
  unicodeForm?: false | "NFC" | "NFD" | "NFKC" | "NFKD";
}

export interface IndexedSkuInput {
  variantId: string;
  sku: string | null | undefined;
}

export interface DupIndexEntry {
  variantId: string;
  sku: string;
  normalizedSku: string;
}

export interface DuplicateGroup {
  normalizedSku: string;
  variants: DupIndexEntry[];
}

export interface ScannableVariant {
  variantId: string;
  productId?: string;
  productTitle?: string;
  variantTitle?: string;
  sku: string | null;
  barcode: string | null;
}

export interface ScanVariantRef {
  variantId: string;
  productId?: string;
  title: string;
  sku: string | null;
  barcode: string | null;
}

export type ScanFinding =
  | {
      kind: "duplicate" | "duplicate_barcode";
      normalizedValue: string;
      variants: ScanVariantRef[];
    }
  | {
      kind: "malformed";
      value: string;
      variants: [ScanVariantRef];
    }
  | {
      kind: "missing_sku" | "missing_barcode";
      variants: [ScanVariantRef];
    };

export interface ScanSummary {
  variantsScanned: number;
  duplicateGroups: number;
  duplicateVariants: number;
  duplicateBarcodeGroups: number;
  duplicateBarcodeVariants: number;
  malformed: number;
  missingSku: number;
  missingBarcode: number;
}

export interface ScanResult {
  findings: ScanFinding[];
  summary: ScanSummary;
}

export interface ScanOptions {
  normalization?: NormalizeSkuOptions;
  skuPattern?: RegExp;
  includeDuplicateBarcodes?: boolean;
}

export interface SequenceCollisionStrategy {
  type: "sequence";
  /** First sequence value to try after the original proposal collides. */
  nextSequence: number;
  render: (sequence: number) => string;
  maxSequenceAttempts?: number;
  suffixSeparator?: string;
  maxSuffixAttempts?: number;
  ownerId?: string;
}

export interface SuffixCollisionStrategy {
  type?: "suffix";
  suffixSeparator?: string;
  maxSuffixAttempts?: number;
  ownerId?: string;
}

export type CollisionStrategy =
  SequenceCollisionStrategy | SuffixCollisionStrategy;

export interface UniqueAssignment {
  sku: string;
  normalizedSku: string;
  collisionsResolved: number;
  resolution: "none" | "sequence" | "suffix";
  sequence?: number;
}

export type BarcodeWriteDecision =
  "no_change" | "allowed_empty" | "allowed_overwrite" | "blocked_overwrite";
