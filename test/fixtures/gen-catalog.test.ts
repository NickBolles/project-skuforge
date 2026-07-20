import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeFixture,
  fixtureQuotas,
  generateCatalog,
} from "./gen-catalog";

describe("fixture catalog generator", () => {
  it.each([120, 10_000])("is deterministic at %i variants", (variants) => {
    expect(generateCatalog({ variants, seed: 42 })).toEqual(
      generateCatalog({ variants, seed: 42 }),
    );
  });

  it.each([120, 10_000])("contains the declared defect quotas at %i variants", (variants) => {
    const catalog = generateCatalog({ variants });
    expect(catalog).toHaveLength(variants);
    expect(analyzeFixture(catalog)).toEqual(fixtureQuotas(variants));
  });

  it("matches the committed small fixture", async () => {
    const committed = JSON.parse(
      await readFile(resolve("test/fixtures/catalog-small.json"), "utf8"),
    );
    expect(committed).toEqual(generateCatalog({ variants: 120 }));
  });
});
