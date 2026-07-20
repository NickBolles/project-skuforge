import type { PrismaClient } from "@prisma/client";
import type {
  CatalogVariant,
  ShopifyCatalog,
  VariantFilter,
} from "../adapters/shopify/catalog";
import { evaluateBarcodeWrite, normalizeSku } from "../core/validate";

export const EDITOR_PAGE_SIZE = 50;

type EditorDb = Pick<PrismaClient, "shop" | "duplicateScan">;

export interface EditorQuery {
  cursor?: string;
  pageSize?: number;
  filter?: VariantFilter;
  duplicateOnly?: boolean;
}

export interface EditorPage {
  variants: CatalogVariant[];
  cursor: string | null;
  hasNext: boolean;
  totalVariants: number;
  duplicateScan: { id: string; finishedAt: Date | null } | null;
}

interface FindingVariantRef {
  variantId?: unknown;
}

function isMissing(value: string | null): boolean {
  return value === null || value.trim() === "";
}

function same(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function matchesFilter(variant: CatalogVariant, filter: VariantFilter = {}): boolean {
  if (filter.vendor && !same(variant.vendor, filter.vendor)) return false;
  if (filter.productType && !same(variant.productType, filter.productType)) return false;
  if (filter.missingSku && !isMissing(variant.sku)) return false;
  if (filter.missingBarcode && !isMissing(variant.barcode)) return false;
  const needle = filter.text?.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    variant.productTitle,
    variant.variantTitle,
    variant.vendor,
    variant.productType,
    variant.sku ?? "",
    variant.barcode ?? "",
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

function parseDuplicateCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  if (!cursor.startsWith("duplicates:")) throw new Error("The duplicate-results cursor is invalid.");
  const offset = Number(cursor.slice("duplicates:".length));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("The duplicate-results cursor is invalid.");
  return offset;
}

function duplicateVariantIds(scan: { findings: Array<{ variants: string }> }): string[] {
  const ids = new Set<string>();
  for (const finding of scan.findings) {
    let refs: FindingVariantRef[];
    try {
      refs = JSON.parse(finding.variants) as FindingVariantRef[];
    } catch {
      continue;
    }
    for (const ref of refs) {
      if (typeof ref.variantId === "string" && ref.variantId) ids.add(ref.variantId);
    }
  }
  return [...ids];
}

async function listDuplicateWindow(
  catalog: ShopifyCatalog,
  ids: string[],
  query: EditorQuery,
): Promise<Pick<EditorPage, "variants" | "cursor" | "hasNext">> {
  const pageSize = query.pageSize ?? EDITOR_PAGE_SIZE;
  let offset = parseDuplicateCursor(query.cursor);
  const variants: CatalogVariant[] = [];
  while (offset < ids.length && variants.length < pageSize) {
    const nextOffset = Math.min(offset + pageSize, ids.length);
    const chunk = await catalog.getVariants(ids.slice(offset, nextOffset));
    variants.push(...chunk.filter((variant) => matchesFilter(variant, query.filter)));
    offset = nextOffset;
  }
  return {
    variants: variants.slice(0, pageSize),
    cursor: offset < ids.length ? `duplicates:${offset}` : null,
    hasNext: offset < ids.length,
  };
}

export async function listEditorPage(
  db: EditorDb,
  catalog: ShopifyCatalog,
  shopDomain: string,
  query: EditorQuery = {},
): Promise<EditorPage> {
  const pageSize = Math.min(Math.max(query.pageSize ?? EDITOR_PAGE_SIZE, 1), 250);
  const shop = await db.shop.upsert({
    where: { shopDomain },
    create: { shopDomain },
    update: {},
  });
  const duplicateScan = await db.duplicateScan.findFirst({
    where: { shopId: shop.id, status: "completed" },
    orderBy: { finishedAt: "desc" },
    include: {
      findings: {
        where: { kind: "duplicate", resolution: "open" },
        select: { variants: true },
      },
    },
  });
  const window = query.duplicateOnly
    ? await listDuplicateWindow(catalog, duplicateScan ? duplicateVariantIds(duplicateScan) : [], { ...query, pageSize })
    : await catalog.listVariantsPage({ cursor: query.cursor, pageSize, filter: query.filter });
  return {
    ...window,
    totalVariants: await catalog.countVariants(),
    duplicateScan: duplicateScan
      ? { id: duplicateScan.id, finishedAt: duplicateScan.finishedAt }
      : null,
  };
}

export type InlineEditField = "sku" | "barcode";

export interface InlineEditInput {
  variantId: string;
  field: InlineEditField;
  newValue: string;
  expectedValue: string | null;
  allowDuplicate?: boolean;
  allowBarcodeOverwrite?: boolean;
}

export type InlineEditResult =
  | { status: "applied"; variant: CatalogVariant }
  | { status: "warning"; duplicateVariantIds: string[]; barcodeOverwrite: boolean }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string };

export async function inlineEditVariant(
  catalog: ShopifyCatalog,
  input: InlineEditInput,
): Promise<InlineEditResult> {
  if (!input.variantId) return { status: "error", message: "Variant ID is required." };
  if (input.newValue.length > 255) return { status: "error", message: "Values are limited to 255 characters." };
  const current = (await catalog.getVariants([input.variantId]))[0];
  if (!current) return { status: "error", message: "The variant no longer exists." };

  const proposed = input.newValue.trim();
  const duplicateVariantIds = proposed
    ? (await catalog.findVariantsBySku([proposed], input.field))
        .filter((variant) => variant.variantId !== input.variantId)
        .map((variant) => variant.variantId)
    : [];
  const barcodeOverwrite = input.field === "barcode" &&
    evaluateBarcodeWrite(current.barcode, proposed, {
      allowOverwrite: input.allowBarcodeOverwrite,
    }) === "blocked_overwrite";
  if ((duplicateVariantIds.length > 0 && !input.allowDuplicate) || barcodeOverwrite) {
    return { status: "warning", duplicateVariantIds, barcodeOverwrite };
  }

  const write = input.field === "sku"
    ? { variantId: input.variantId, sku: proposed, expectedSku: input.expectedValue }
    : {
        variantId: input.variantId,
        barcode: proposed,
        expectedBarcode: input.expectedValue,
        allowBarcodeOverwrite: input.allowBarcodeOverwrite,
      };
  const result = (await catalog.updateVariants([write]))[0];
  if (!result || result.status === "error") {
    return { status: "error", message: result?.message ?? "The catalog write failed." };
  }
  if (result.status === "skipped_conflict") {
    return {
      status: "conflict",
      message: `${result.message ?? "The variant changed after it was loaded."} Reload this row and try again.`,
    };
  }
  const variant = (await catalog.getVariants([input.variantId]))[0];
  if (!variant) return { status: "error", message: "The updated variant could not be reloaded." };
  const persisted = variant[input.field];
  if (normalizeSku(persisted ?? "") !== normalizeSku(proposed)) {
    return { status: "error", message: "The catalog did not persist the requested value." };
  }
  return { status: "applied", variant };
}
