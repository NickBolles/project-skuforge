import { canonicalTokenKind, isPositiveWidth } from "./grammar";
import type {
  PatternAst,
  PatternParseError,
  PatternParseResult,
  TokenNode,
} from "./types";

function parseToken(raw: string, position: number): TokenNode | PatternParseError {
  const content = raw.slice(1, -1);
  if (content.length === 0) {
    return {
      code: "EMPTY_TOKEN",
      message: "Token cannot be empty.",
      position,
      length: raw.length,
    };
  }

  const parts = content.split(":");
  const kind = canonicalTokenKind(parts[0]!);
  if (!kind) {
    return {
      code: "UNKNOWN_TOKEN",
      message: `Unknown token "${parts[0]}".`,
      position: position + 1,
      length: parts[0]!.length,
    };
  }

  if (kind === "option") {
    if (!parts[1]) {
      return {
        code: "MISSING_OPTION_NAME",
        message: "Option tokens require a name, for example {option:Size}.",
        position: position + "{option:".length,
        length: Math.max(1, raw.length - "{option:".length - 1),
      };
    }
    if (parts.length > 3) {
      return {
        code: "TOO_MANY_ARGUMENTS",
        message: "Option tokens accept only a name and optional truncation width.",
        position,
        length: raw.length,
      };
    }
    if (parts[2] !== undefined && !isPositiveWidth(parts[2])) {
      return {
        code: "INVALID_ARGUMENT",
        message: "Truncation width must be a positive safe integer.",
        position: position + raw.lastIndexOf(parts[2]),
        length: Math.max(1, parts[2].length),
      };
    }
    return {
      type: "token",
      kind,
      optionName: parts[1],
      limit: parts[2] === undefined ? undefined : Number(parts[2]),
      position,
      raw,
    };
  }

  if (parts.length > 2) {
    return {
      code: "TOO_MANY_ARGUMENTS",
      message: `${parts[0]} accepts at most one numeric argument.`,
      position,
      length: raw.length,
    };
  }
  if (parts[1] !== undefined && !isPositiveWidth(parts[1])) {
    return {
      code: "INVALID_ARGUMENT",
      message: `${kind === "seq" ? "Padding" : "Truncation"} width must be a positive safe integer.`,
      position: position + raw.lastIndexOf(parts[1]),
      length: Math.max(1, parts[1].length),
    };
  }

  return {
    type: "token",
    kind,
    limit: kind === "seq" || parts[1] === undefined ? undefined : Number(parts[1]),
    padding: kind === "seq" && parts[1] !== undefined ? Number(parts[1]) : undefined,
    position,
    raw,
  };
}

export function parsePattern(pattern: string): PatternParseResult {
  const ast: PatternAst = { source: pattern, nodes: [] };
  const errors: PatternParseError[] = [];
  let literalStart = 0;
  let cursor = 0;

  const pushLiteral = (end: number): void => {
    if (end > literalStart) {
      ast.nodes.push({
        type: "literal",
        value: pattern.slice(literalStart, end),
        position: literalStart,
      });
    }
  };

  while (cursor < pattern.length) {
    const character = pattern[cursor];
    if (character === "}") {
      pushLiteral(cursor);
      errors.push({
        code: "UNEXPECTED_CLOSE_BRACE",
        message: "Unexpected closing brace.",
        position: cursor,
        length: 1,
      });
      cursor += 1;
      literalStart = cursor;
      continue;
    }
    if (character !== "{") {
      cursor += 1;
      continue;
    }

    pushLiteral(cursor);
    const close = pattern.indexOf("}", cursor + 1);
    if (close === -1) {
      errors.push({
        code: "UNCLOSED_TOKEN",
        message: "Token is missing a closing brace.",
        position: cursor,
        length: pattern.length - cursor,
      });
      cursor = pattern.length;
      literalStart = cursor;
      break;
    }

    const nestedOpen = pattern.indexOf("{", cursor + 1);
    if (nestedOpen !== -1 && nestedOpen < close) {
      errors.push({
        code: "INVALID_ARGUMENT",
        message: "Tokens cannot contain an opening brace.",
        position: nestedOpen,
        length: 1,
      });
      cursor = close + 1;
      literalStart = cursor;
      continue;
    }

    const raw = pattern.slice(cursor, close + 1);
    const parsed = parseToken(raw, cursor);
    if ("code" in parsed) errors.push(parsed);
    else ast.nodes.push(parsed);
    cursor = close + 1;
    literalStart = cursor;
  }

  pushLiteral(pattern.length);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, ast };
}

export const parse = parsePattern;
