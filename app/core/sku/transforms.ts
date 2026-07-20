import type { SkuCasing, SkuRenderConfig, TokenNode } from "./types";

function lookupRecord(
  record: Readonly<Record<string, string>>,
  value: string,
): string | undefined {
  const wanted = value.trim().toLocaleLowerCase();
  const entry = Object.entries(record).find(
    ([key]) => key.trim().toLocaleLowerCase() === wanted,
  );
  return entry?.[1];
}

function tokenScope(token: TokenNode): string {
  return token.kind === "option" ? `option:${token.optionName}` : token.kind;
}

export function abbreviate(
  value: string,
  token: TokenNode,
  config: SkuRenderConfig,
): string {
  const dictionary = config.abbreviations;
  if (!dictionary) return value;

  const scopes = [tokenScope(token), token.kind, "*"];
  for (const scope of scopes) {
    const scopedEntry = Object.entries(dictionary).find(
      ([key]) => key.toLocaleLowerCase() === scope.toLocaleLowerCase(),
    )?.[1];
    if (scopedEntry && typeof scopedEntry !== "string") {
      const match = lookupRecord(scopedEntry, value);
      if (match !== undefined) return match;
    }
  }

  const flatEntries = Object.fromEntries(
    Object.entries(dictionary).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string",
    ),
  );
  return lookupRecord(flatEntries, value) ?? value;
}

export function applyCasing(value: string, casing: SkuCasing = "asis"): string {
  if (casing === "upper") return value.toLocaleUpperCase();
  if (casing === "lower") return value.toLocaleLowerCase();
  return value;
}

export function transformTokenValue(
  value: string,
  token: TokenNode,
  config: SkuRenderConfig,
): string {
  let transformed = abbreviate(value, token, config);
  if (config.stripNonAlphanumeric) {
    transformed = transformed.replace(/[^\p{L}\p{N}]/gu, "");
  }
  transformed = applyCasing(transformed, config.casing);
  if (token.limit !== undefined) {
    transformed = Array.from(transformed).slice(0, token.limit).join("");
  }
  return transformed;
}
