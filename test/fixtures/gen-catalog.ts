import type { CatalogVariant } from "../../app/adapters/shopify/catalog";

const vendors = ["Northstar", "Acme", "Juniper", "Redwood", "Orbit"];
const productTypes = ["Shirt", "Hat", "Mug", "Shoes", "Bag"];
const colors = ["Red", "Blue", "Black", "Natural", "Green"];
const sizes = ["XS", "S", "M", "L", "XL"];

export interface FixtureOptions {
  variants: number;
  seed?: number;
}

export interface FixtureQuotas {
  missingSku: number;
  missingBarcode: number;
  malformedSku: number;
  duplicateVariants: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

export function fixtureQuotas(variants: number): FixtureQuotas {
  if (!Number.isSafeInteger(variants) || variants < 1) {
    throw new Error("variants must be a positive safe integer");
  }

  return {
    missingSku: Math.max(1, Math.floor(variants * 0.1)),
    missingBarcode: Math.max(1, Math.floor(variants * 0.08)),
    malformedSku: Math.max(1, Math.floor(variants * 0.05)),
    duplicateVariants: Math.max(3, Math.floor(variants * 0.04)),
  };
}

export function generateCatalog({ variants, seed = 0x5f3759df }: FixtureOptions): CatalogVariant[] {
  const quotas = fixtureQuotas(variants);
  const random = mulberry32(seed);
  const catalog: CatalogVariant[] = [];
  const duplicateSku = "SEEDED-DUPLICATE-001";

  for (let index = 0; index < variants; index += 1) {
    const ordinal = index + 1;
    const productOrdinal = Math.floor(index / 3) + 1;
    const vendor = pick(vendors, random);
    const productType = pick(productTypes, random);
    const color = pick(colors, random);
    const size = pick(sizes, random);
    let sku: string | null = `SKU-${vendor.slice(0, 3).toUpperCase()}-${ordinal
      .toString()
      .padStart(6, "0")}`;

    if (index < quotas.missingSku) {
      sku = null;
    } else if (index < quotas.missingSku + quotas.malformedSku) {
      sku = `malformed sku ${ordinal}`;
    } else if (
      index <
      quotas.missingSku + quotas.malformedSku + quotas.duplicateVariants
    ) {
      sku = duplicateSku;
    }

    catalog.push({
      productId: `gid://shopify/Product/${1_000_000 + productOrdinal}`,
      variantId: `gid://shopify/ProductVariant/${2_000_000 + ordinal}`,
      productTitle: `${vendor} ${productType} ${productOrdinal}`,
      variantTitle: `${color} / ${size}`,
      vendor,
      productType,
      tags: [productType.toLowerCase(), ordinal % 2 === 0 ? "retail" : "online"],
      options: { Color: color, Size: size },
      sku,
      barcode:
        index >= variants - quotas.missingBarcode
          ? null
          : (7_000_000_000_000 + ordinal).toString(),
      price: (10 + Math.floor(random() * 19_000) / 100).toFixed(2),
      status: ordinal % 31 === 0 ? "DRAFT" : ordinal % 47 === 0 ? "ARCHIVED" : "ACTIVE",
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ordinal % 60)).toISOString(),
    });
  }

  return catalog;
}

export function analyzeFixture(catalog: readonly CatalogVariant[]): FixtureQuotas {
  const counts = new Map<string, number>();
  for (const variant of catalog) {
    if (variant.sku) counts.set(variant.sku, (counts.get(variant.sku) ?? 0) + 1);
  }

  return {
    missingSku: catalog.filter((variant) => variant.sku === null).length,
    missingBarcode: catalog.filter((variant) => variant.barcode === null).length,
    malformedSku: catalog.filter((variant) => variant.sku?.startsWith("malformed sku ")).length,
    duplicateVariants: [...counts.values()]
      .filter((count) => count > 1)
      .reduce((total, count) => total + count, 0),
  };
}
