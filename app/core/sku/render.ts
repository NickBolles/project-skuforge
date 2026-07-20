import { transformTokenValue } from "./transforms";
import type {
  PatternAst,
  SkuRenderConfig,
  SkuRenderContext,
  TokenNode,
} from "./types";
import { SkuRenderError } from "./types";

function optionValue(
  options: SkuRenderContext["options"],
  name: string,
): string | null | undefined {
  if (!options) return undefined;
  const match = Object.entries(options).find(
    ([key]) => key.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  return match?.[1];
}

function rawTokenValue(
  token: TokenNode,
  context: SkuRenderContext,
  seq: number,
  config: SkuRenderConfig,
): string | null | undefined {
  switch (token.kind) {
    case "prefix":
      return config.prefix;
    case "vendor":
      return context.vendor;
    case "product-type":
      return context.productType;
    case "title":
      return context.productTitle ?? context.title;
    case "option":
      return optionValue(context.options, token.optionName!);
    case "seq":
      if (!Number.isSafeInteger(seq) || seq < 0) {
        throw new RangeError("seq must be a non-negative safe integer");
      }
      return seq.toString().padStart(token.padding ?? 1, "0");
  }
}

function cleanSkippedSeparators(value: string): string {
  return value
    .replace(/([^\p{L}\p{N}\s])\1+/gu, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\p{S}\s_]+|[\p{P}\p{S}\s_]+$/gu, "");
}

export function render(
  ast: PatternAst,
  context: SkuRenderContext,
  seq: number,
  config: SkuRenderConfig = {},
): string {
  let skipped = false;
  const rendered = ast.nodes.map((node) => {
    if (node.type === "literal") return node.value;
    const raw = rawTokenValue(node, context, seq, config);
    if (raw === null || raw === undefined || raw === "") {
      const policy = config.missingValuePolicy ?? "skip-token";
      if (policy === "error") throw new SkuRenderError(node);
      if (policy === "placeholder") {
        return transformTokenValue(config.missingPlaceholder ?? "MISSING", node, config);
      }
      skipped = true;
      return "";
    }
    return node.kind === "seq" ? raw : transformTokenValue(raw, node, config);
  });

  const value = rendered.join("");
  return skipped ? cleanSkippedSeparators(value) : value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function genericTokenPattern(token: TokenNode, config: SkuRenderConfig): string {
  const allowsEmpty = (config.missingValuePolicy ?? "skip-token") === "skip-token";
  const minimum = allowsEmpty ? 0 : 1;
  const body = config.stripNonAlphanumeric ? "[\\p{L}\\p{N}]" : "[\\s\\S]";
  const generic =
    token.limit === undefined
      ? `${body}${allowsEmpty ? "*" : "+"}`
      : `${body}{${minimum},${token.limit}}`;
  if ((config.missingValuePolicy ?? "skip-token") !== "placeholder") return generic;
  const placeholder = transformTokenValue(
    config.missingPlaceholder ?? "MISSING",
    token,
    config,
  );
  return `(?:${generic}|${escapeRegex(placeholder)})`;
}

function literalPattern(value: string, separatorsMayCollapse: boolean): string {
  if (!separatorsMayCollapse) return escapeRegex(value);
  return value
    .split(/([\p{P}\p{S}\s_]+)/u)
    .filter(Boolean)
    .map((part) =>
      /^[\p{P}\p{S}\s_]+$/u.test(part)
        ? "[\\p{P}\\p{S}\\s_]*"
        : escapeRegex(part),
    )
    .join("");
}

export function patternToRegex(
  ast: PatternAst,
  config: SkuRenderConfig = {},
): RegExp {
  const skipPolicy = (config.missingValuePolicy ?? "skip-token") === "skip-token";
  const source = ast.nodes
    .map((node) => {
      if (node.type === "literal") return literalPattern(node.value, skipPolicy);
      if (node.kind === "seq") return `\\d{${node.padding ?? 1},}`;
      if (node.kind === "prefix" && config.prefix) {
        return escapeRegex(transformTokenValue(config.prefix, node, config));
      }
      return genericTokenPattern(node, config);
    })
    .join("");
  return new RegExp(`^${source}$`, "u");
}
