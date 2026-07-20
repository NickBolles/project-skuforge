import { describe, expect, it } from "vitest";
import {
  SkuRenderError,
  TOKEN_REFERENCE,
  parsePattern,
  patternToRegex,
  render,
  transformTokenValue,
  type PatternAst,
  type SkuRenderConfig,
} from ".";

function ast(pattern: string): PatternAst {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.ast;
}

describe("SKU pattern parser", () => {
  it.each([
    ["{prefix}-{vendor:3}-{option:Size}-{seq:4}", 7],
    ["{category}/{title:12}", 3],
    ["free text", 1],
    ["", 0],
  ])("parses %s", (pattern, nodeCount) => {
    const result = parsePattern(pattern);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ast.nodes).toHaveLength(nodeCount);
  });

  it.each([
    ["{}", "EMPTY_TOKEN", 0],
    ["x{vendor", "UNCLOSED_TOKEN", 1],
    ["x}y", "UNEXPECTED_CLOSE_BRACE", 1],
    ["{wat}", "UNKNOWN_TOKEN", 1],
    ["{option}", "MISSING_OPTION_NAME", 8],
    ["{vendor:0}", "INVALID_ARGUMENT", 8],
    ["{seq:nope}", "INVALID_ARGUMENT", 5],
    ["{option:Size:2:3}", "TOO_MANY_ARGUMENTS", 0],
    ["{{vendor}}", "INVALID_ARGUMENT", 1],
  ])("returns a positioned error for %s", (pattern, code, position) => {
    const result = parsePattern(pattern);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code, position });
      expect(result.errors[0]!.length).toBeGreaterThan(0);
    }
  });

  it("returns all recoverable errors", () => {
    const result = parsePattern("{wat}-{seq:0}-}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.code)).toEqual([
      "UNKNOWN_TOKEN",
      "INVALID_ARGUMENT",
      "UNEXPECTED_CLOSE_BRACE",
    ]);
  });

  it("keeps the token-reference examples stable", () => {
    expect(TOKEN_REFERENCE).toMatchInlineSnapshot(`
      [
        {
          "description": "Configured literal prefix",
          "syntax": "{prefix}",
        },
        {
          "description": "Vendor, optionally truncated",
          "syntax": "{vendor[:N]}",
        },
        {
          "description": "Product type, optionally truncated",
          "syntax": "{product-type[:N]} / {category[:N]}",
        },
        {
          "description": "Product title, optionally truncated",
          "syntax": "{title[:N]}",
        },
        {
          "description": "Named variant option, optionally truncated",
          "syntax": "{option:Name[:N]}",
        },
        {
          "description": "Sequence with optional zero-padding",
          "syntax": "{seq[:N]}",
        },
      ]
    `);
  });
});

describe("SKU renderer and transforms", () => {
  it("renders every token and the category alias", () => {
    const context = {
      vendor: "Northstar",
      productType: "Shirt",
      productTitle: "Trail Shirt",
      options: { Size: "Extra Large" },
    };
    expect(
      render(
        ast("{prefix}-{vendor:3}-{category}-{title}-{option:Size}-{seq:4}"),
        context,
        12,
        { prefix: "WEB" },
      ),
    ).toBe("WEB-Nor-Shirt-Trail Shirt-Extra Large-0012");
  });

  it("applies abbreviation, stripping, casing, then Unicode-safe truncation", () => {
    const token = ast("{option:Size:1}").nodes[0];
    if (!token || token.type !== "token") throw new Error("expected token");
    expect(
      transformTokenValue("Extra Large", token, {
        abbreviations: { "option:Size": { "extra large": "éX!" } },
        stripNonAlphanumeric: true,
        casing: "upper",
      }),
    ).toBe("É");
  });

  it("supports flat and wildcard abbreviation dictionaries", () => {
    expect(
      render(ast("{vendor}-{product-type}"), { vendor: "Acme", productType: "Shirt" }, 1, {
        abbreviations: { Acme: "AC", "*": { Shirt: "SH" } },
      }),
    ).toBe("AC-SH");
  });

  it("preserves Unicode letters while stripping punctuation", () => {
    expect(
      render(ast("{title}"), { productTitle: "Café 東京 — Tee!" }, 1, {
        stripNonAlphanumeric: true,
        casing: "upper",
      }),
    ).toBe("CAFÉ東京TEE");
  });

  it("defaults missing values to skipped tokens and collapses doubled separators", () => {
    expect(render(ast("{vendor}--{option:Size}--{seq:3}"), { vendor: "Acme" }, 7)).toBe(
      "Acme-007",
    );
    expect(render(ast("{vendor}-{seq}"), {}, 1)).toBe("1");
    expect(render(ast("{seq}-{vendor}"), {}, 1)).toBe("1");
  });

  it("renders a configured placeholder for missing values", () => {
    expect(
      render(ast("{vendor}-{option:Size}-{seq}"), { vendor: "" }, 2, {
        missingValuePolicy: "placeholder",
        missingPlaceholder: "n/a",
        stripNonAlphanumeric: true,
        casing: "upper",
      }),
    ).toBe("NA-NA-2");
  });

  it("throws a structured render error under the error policy", () => {
    expect(() =>
      render(ast("{vendor}"), { vendor: null }, 1, { missingValuePolicy: "error" }),
    ).toThrow(SkuRenderError);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid sequence %s", (seq) => {
    expect(() => render(ast("{seq}"), {}, seq)).toThrow(RangeError);
  });
});

describe("patternToRegex", () => {
  it("rejects malformed fixed-format values", () => {
    const regex = patternToRegex(ast("SKU-{vendor:3}-{seq:4}"), {
      stripNonAlphanumeric: true,
      casing: "upper",
      missingValuePolicy: "error",
    });
    expect(regex.test("SKU-ACM-0001")).toBe(true);
    expect(regex.test("WRONG-ACM-0001")).toBe(false);
    expect(regex.test("SKU-ACM-X001")).toBe(false);
  });

  it("matches every rendered output across 1,000 seeded contexts", () => {
    let state = 0x9e3779b9;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const patterns = [
      "{prefix}-{vendor:3}-{option:Size}-{seq:4}",
      "{category}/{title:8}/{seq}",
      "{vendor}--{option:Color}--{seq:2}",
    ];
    const configs: SkuRenderConfig[] = [
      { prefix: "SKU", stripNonAlphanumeric: true, casing: "upper" },
      { casing: "lower", missingValuePolicy: "placeholder", missingPlaceholder: "NA" },
      { abbreviations: { "Extra Large": "XL" } },
    ];

    for (let index = 0; index < 1_000; index += 1) {
      const pattern = patterns[index % patterns.length]!;
      const config = configs[index % configs.length]!;
      const parsed = ast(pattern);
      const context = {
        vendor: random() < 0.15 ? null : random() < 0.5 ? "Acme & Sons" : "München",
        productType: random() < 0.1 ? "" : "Trail Shirt",
        productTitle: random() < 0.1 ? undefined : "Café — 東京 Tee",
        options: {
          Size: random() < 0.2 ? undefined : "Extra Large",
          Color: random() < 0.2 ? undefined : "Blue/Green",
        },
      };
      const value = render(parsed, context, index + 1, config);
      expect(patternToRegex(parsed, config).test(value), `${pattern}: ${value}`).toBe(true);
    }
  });
});
