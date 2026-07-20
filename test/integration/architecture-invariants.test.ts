import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { assertAuthConfiguration } from "../../app/shopify.server";

describe("load-bearing architecture invariants", () => {
  it("keeps generated SKU writes behind uniqueness, the shop lock, CAS, and verification", async () => {
    const source = await readFile("app/services/generation.server.ts", "utf8");
    expect(source).toContain("assignUnique(");
    expect(source).toContain("acquireJobLock(");
    expect(source).toContain("expectedSku:");
    expect(source).toContain("verifyGenerationRun(");
    expect(source.match(/catalog\.updateVariants\(/g)).toHaveLength(1);
    expect(source.indexOf("assignUnique(")).toBeLessThan(source.indexOf("catalog.updateVariants("));
  });

  it("keeps production authentication fail-closed for missing credentials and mock mode", () => {
    expect(() => assertAuthConfiguration({ NODE_ENV: "production", AUTH_MODE: "mock" })).toThrow(/forbidden/);
    expect(() => assertAuthConfiguration({ NODE_ENV: "production", AUTH_MODE: "shopify" })).toThrow(/requires SHOPIFY_API_KEY/);
    expect(assertAuthConfiguration({ NODE_ENV: "production", AUTH_MODE: "shopify", SHOPIFY_API_KEY: "key", SHOPIFY_API_SECRET: "secret" }).AUTH_MODE).toBe("shopify");
  });
});
