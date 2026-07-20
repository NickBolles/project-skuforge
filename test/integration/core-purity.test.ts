import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("core purity lint boundary", () => {
  it("rejects a deliberate adapter import inside app/core", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText(
      'import type { ShopifyCatalog } from "../adapters/shopify/catalog";\nexport type Bad = ShopifyCatalog;\n',
      { filePath: "app/core/deliberately-bad.ts" },
    );

    expect(result?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "no-restricted-imports", severity: 2 }),
      ]),
    );
  });
});
