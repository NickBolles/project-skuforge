export type SkuTokenKind =
  | "prefix"
  | "vendor"
  | "product-type"
  | "title"
  | "option"
  | "seq";

export interface LiteralNode {
  type: "literal";
  value: string;
  position: number;
}

export interface TokenNode {
  type: "token";
  kind: SkuTokenKind;
  /** Present only for option tokens. Option-name matching is case-insensitive. */
  optionName?: string;
  /** Character limit for text tokens. */
  limit?: number;
  /** Minimum zero-padded width for sequence tokens. */
  padding?: number;
  position: number;
  raw: string;
}

export type PatternNode = LiteralNode | TokenNode;

export interface PatternAst {
  source: string;
  nodes: PatternNode[];
}

export type PatternErrorCode =
  | "EMPTY_TOKEN"
  | "UNCLOSED_TOKEN"
  | "UNEXPECTED_CLOSE_BRACE"
  | "UNKNOWN_TOKEN"
  | "INVALID_ARGUMENT"
  | "MISSING_OPTION_NAME"
  | "TOO_MANY_ARGUMENTS";

export interface PatternParseError {
  code: PatternErrorCode;
  message: string;
  /** Zero-based character offset in the source pattern. */
  position: number;
  length: number;
}

export type PatternParseResult =
  | { ok: true; ast: PatternAst }
  | { ok: false; errors: PatternParseError[] };

export interface SkuRenderContext {
  vendor?: string | null;
  productType?: string | null;
  productTitle?: string | null;
  title?: string | null;
  options?: Readonly<Record<string, string | null | undefined>>;
}

export type MissingValuePolicy = "skip-token" | "placeholder" | "error";
export type SkuCasing = "upper" | "lower" | "asis";

export type AbbreviationDictionary = Record<
  string,
  string | Readonly<Record<string, string>>
>;

export interface SkuRenderConfig {
  prefix?: string;
  casing?: SkuCasing;
  stripNonAlphanumeric?: boolean;
  /**
   * Flat entries apply globally. Nested entries can be scoped by token name
   * (for example `vendor`, `product-type`, `option:Size`, or `*`).
   * Lookups are case-insensitive.
   */
  abbreviations?: Readonly<AbbreviationDictionary>;
  missingValuePolicy?: MissingValuePolicy;
  missingPlaceholder?: string;
  separator?: string;
}

export class SkuRenderError extends Error {
  readonly token: TokenNode;

  constructor(token: TokenNode) {
    super(`Missing value for token ${token.raw} at position ${token.position}.`);
    this.name = "SkuRenderError";
    this.token = token;
  }
}
