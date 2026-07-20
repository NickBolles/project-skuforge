import { describe, expect, it } from "vitest";
import { InMemoryShopifyCatalog } from "../../app/adapters/shopify/inMemoryCatalog";
import { scanCatalog } from "../../app/core/validate";
import { generateCatalog } from "../fixtures/gen-catalog";

describe("10k catalog performance budget", () => {
  it("scans 10,000 variants within five seconds", { timeout: 10_000 }, async () => {
    const catalog = new InMemoryShopifyCatalog(generateCatalog({ variants: 10_000 }));
    const started = performance.now();
    const result = await scanCatalog(catalog.streamAllVariants({ batchSize: 250 }));
    const elapsed = performance.now() - started;
    console.info(`PERF scan_10k_ms=${elapsed.toFixed(1)}`);
    expect(result.summary.variantsScanned).toBe(10_000);
    expect(elapsed).toBeLessThan(5_000);
  });
});
