import { readFile } from "node:fs/promises";

import { parsePattern, render } from "../app/core/sku";
import { scanCatalog } from "../app/core/validate";
import type { CatalogVariant } from "../app/adapters/shopify/catalog";

const variants = JSON.parse(
  await readFile(
    new URL("../test/fixtures/catalog-small.json", import.meta.url),
    "utf8",
  ),
) as CatalogVariant[];
const patterns = [
  "{vendor:3}-{product-type:3}-{seq:4}",
  "{prefix}-{option:Color:2}-{option:Size}-{seq:3}",
  "{category}-{title:8}-{seq}",
];

for (const pattern of patterns) {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  console.log(`\n${pattern}`);
  variants.slice(0, 20).forEach((variant, index) => {
    console.log(
      render(parsed.ast, variant, index + 1, {
        prefix: "SKU",
        casing: "upper",
        stripNonAlphanumeric: true,
      }),
    );
  });
}

async function* fixtureBatches() {
  for (let index = 0; index < variants.length; index += 25) {
    yield variants.slice(index, index + 25);
  }
}

const scan = await scanCatalog(fixtureBatches(), {
  skuPattern: /^(?:SKU-[A-Z]{3}-\d{6}|SEEDED-DUPLICATE-001)$/,
});
console.log(
  `\nScan: ${scan.summary.duplicateGroups} duplicate groups, ` +
    `${scan.summary.malformed} malformed, ${scan.summary.missingSku} missing SKU, ` +
    `${scan.summary.missingBarcode} missing barcode.`,
);
