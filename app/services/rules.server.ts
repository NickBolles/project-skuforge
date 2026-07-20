import type { PrismaClient, SkuRuleSet } from "@prisma/client";
import { z } from "zod";
import { parsePattern, patternToRegex, type PatternParseError, type SkuRenderConfig } from "../core/sku";

const stringList = z.array(z.string().trim().min(1)).max(100).default([]);

export const ruleConfigSchema = z.object({
  prefix: z.string().max(64).optional(),
  separator: z.string().max(8).optional(),
  casing: z.enum(["upper", "lower", "asis"]).default("upper"),
  stripNonAlphanumeric: z.boolean().default(true),
  abbreviations: z.record(z.union([z.string(), z.record(z.string())])).default({}),
  missingValuePolicy: z.enum(["skip-token", "placeholder", "error"]).default("skip-token"),
  missingPlaceholder: z.string().max(64).optional(),
  scope: z.object({
    vendors: stringList,
    productTypes: stringList,
    tags: stringList,
  }).default({ vendors: [], productTypes: [], tags: [] }),
});

export type RuleConfig = z.infer<typeof ruleConfigSchema> & SkuRenderConfig;

export class RuleValidationError extends Error {
  constructor(
    readonly code: "INVALID_PATTERN" | "INVALID_CONFIG" | "DEFAULT_EXISTS" | "NOT_FOUND",
    message: string,
    readonly patternErrors: PatternParseError[] = [],
  ) {
    super(message);
    this.name = "RuleValidationError";
  }
}

export interface RuleInput {
  name: string;
  pattern: string;
  config?: unknown;
  isDefault?: boolean;
  active?: boolean;
}

type RulesDb = Pick<PrismaClient, "shop" | "skuRuleSet" | "$transaction">;

export function parseRuleConfig(value: string | unknown): RuleConfig {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    return ruleConfigSchema.parse(raw ?? {});
  } catch (error) {
    throw new RuleValidationError(
      "INVALID_CONFIG",
      error instanceof Error ? error.message : "Rule configuration is invalid.",
    );
  }
}

export function ruleSkuPattern(rule: Pick<SkuRuleSet, "pattern" | "config">): RegExp {
  const parsed = parsePattern(rule.pattern);
  if (!parsed.ok) {
    const first = parsed.errors[0]!;
    throw new RuleValidationError(
      "INVALID_PATTERN",
      `${first.message} (position ${first.position})`,
      parsed.errors,
    );
  }
  return patternToRegex(parsed.ast, parseRuleConfig(rule.config));
}

function validateInput(input: RuleInput): { name: string; pattern: string; config: RuleConfig } {
  const name = input.name.trim();
  if (!name) throw new RuleValidationError("INVALID_CONFIG", "Rule name is required.");
  const pattern = input.pattern.trim();
  const parsed = parsePattern(pattern);
  if (!parsed.ok) {
    const first = parsed.errors[0]!;
    throw new RuleValidationError(
      "INVALID_PATTERN",
      `${first.message} (position ${first.position})`,
      parsed.errors,
    );
  }
  return { name, pattern, config: parseRuleConfig(input.config ?? {}) };
}

export async function ensureShop(db: RulesDb, shopDomain: string) {
  return db.shop.upsert({
    where: { shopDomain },
    create: { shopDomain },
    // A successfully authenticated request after reinstall reactivates the shop.
    update: { uninstalledAt: null },
  });
}

export async function listRules(db: RulesDb, shopDomain: string): Promise<SkuRuleSet[]> {
  const shop = await ensureShop(db, shopDomain);
  return db.skuRuleSet.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "asc" } });
}

export async function getRule(db: RulesDb, shopDomain: string, ruleId: string): Promise<SkuRuleSet> {
  const shop = await ensureShop(db, shopDomain);
  const rule = await db.skuRuleSet.findFirst({ where: { id: ruleId, shopId: shop.id } });
  if (!rule) throw new RuleValidationError("NOT_FOUND", "Rule was not found.");
  return rule;
}

export async function createRule(db: RulesDb, shopDomain: string, input: RuleInput): Promise<SkuRuleSet> {
  const validated = validateInput(input);
  const shop = await ensureShop(db, shopDomain);
  if (input.isDefault) {
    const existing = await db.skuRuleSet.findFirst({ where: { shopId: shop.id, isDefault: true } });
    if (existing) throw new RuleValidationError("DEFAULT_EXISTS", `“${existing.name}” is already the default rule.`);
  }
  return db.skuRuleSet.create({
    data: {
      shopId: shop.id,
      name: validated.name,
      pattern: validated.pattern,
      config: JSON.stringify(validated.config),
      isDefault: input.isDefault ?? false,
      active: input.active ?? true,
    },
  });
}

export async function updateRule(
  db: RulesDb,
  shopDomain: string,
  ruleId: string,
  input: RuleInput,
): Promise<SkuRuleSet> {
  const validated = validateInput(input);
  const current = await getRule(db, shopDomain, ruleId);
  if (input.isDefault && !current.isDefault) {
    const existing = await db.skuRuleSet.findFirst({
      where: { shopId: current.shopId, isDefault: true, NOT: { id: current.id } },
    });
    if (existing) throw new RuleValidationError("DEFAULT_EXISTS", `“${existing.name}” is already the default rule.`);
  }
  return db.skuRuleSet.update({
    where: { id: current.id },
    data: {
      name: validated.name,
      pattern: validated.pattern,
      config: JSON.stringify(validated.config),
      isDefault: input.isDefault ?? false,
      active: input.active ?? true,
    },
  });
}

export async function deleteRule(db: RulesDb, shopDomain: string, ruleId: string): Promise<void> {
  const rule = await getRule(db, shopDomain, ruleId);
  await db.skuRuleSet.delete({ where: { id: rule.id } });
}
