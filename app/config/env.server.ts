import { z } from "zod";

const nonBlankOptional = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const booleanEnv = z.preprocess(
  (value) => typeof value === "string" ? ["1", "true", "yes", "on"].includes(value.toLowerCase()) : value,
  z.boolean().default(false),
);

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_MODE: z.enum(["shopify", "mock"]).default("shopify"),
  SHOPIFY_API_KEY: nonBlankOptional,
  SHOPIFY_API_SECRET: nonBlankOptional,
  SHOPIFY_APP_URL: z.string().url().default("http://localhost:3000"),
  SCOPES: z.string().default("read_products,write_products"),
  DATABASE_URL: nonBlankOptional,
  CRON_SECRET: nonBlankOptional,
  MOCK_PLAN: z.enum(["free", "pro", "premium"]).default("free"),
  BILLING_TEST: booleanEnv,
  SHOP_CUSTOM_DOMAIN: nonBlankOptional,
});

export type AppEnv = z.infer<typeof baseEnvSchema>;

export class EnvironmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigurationError";
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = baseEnvSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new EnvironmentConfigurationError(`Invalid environment configuration: ${details}`);
  }

  const env = result.data;
  if (env.NODE_ENV === "production" && env.AUTH_MODE === "mock") {
    throw new EnvironmentConfigurationError(
      "AUTH_MODE=mock is forbidden when NODE_ENV=production.",
    );
  }

  if (env.AUTH_MODE === "shopify" && (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET)) {
    const hint =
      env.NODE_ENV === "production"
        ? "Production requires SHOPIFY_API_KEY and SHOPIFY_API_SECRET."
        : "Set Shopify credentials or explicitly run with AUTH_MODE=mock for local development.";
    throw new EnvironmentConfigurationError(hint);
  }

  return env;
}
