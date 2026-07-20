import { describe, expect, it } from "vitest";
import { EnvironmentConfigurationError } from "../../app/config/env.server";
import { assertAuthConfiguration } from "../../app/shopify.server";

describe("auth boot configuration", () => {
  it("allows explicit mock auth in non-production without credentials", () => {
    expect(
      assertAuthConfiguration({ NODE_ENV: "development", AUTH_MODE: "mock" }),
    ).toMatchObject({ AUTH_MODE: "mock", MOCK_PLAN: "free" });
  });

  it("rejects mock auth in production even if credentials exist", () => {
    expect(() =>
      assertAuthConfiguration({
        NODE_ENV: "production",
        AUTH_MODE: "mock",
        SHOPIFY_API_KEY: "key",
        SHOPIFY_API_SECRET: "secret",
      }),
    ).toThrowError(/forbidden/);
  });

  it("rejects missing Shopify credentials in production", () => {
    expect(() =>
      assertAuthConfiguration({ NODE_ENV: "production", AUTH_MODE: "shopify" }),
    ).toThrowError(/Production requires SHOPIFY_API_KEY and SHOPIFY_API_SECRET/);
  });

  it("rejects an unset development mode with a helpful mock-auth hint", () => {
    expect(() => assertAuthConfiguration({ NODE_ENV: "development" })).toThrowError(
      /explicitly run with AUTH_MODE=mock/,
    );
  });

  it("accepts production Shopify auth when both credentials are present", () => {
    expect(
      assertAuthConfiguration({
        NODE_ENV: "production",
        AUTH_MODE: "shopify",
        SHOPIFY_API_KEY: "key",
        SHOPIFY_API_SECRET: "secret",
      }),
    ).toMatchObject({ AUTH_MODE: "shopify", NODE_ENV: "production" });
  });

  it("uses a dedicated error type", () => {
    expect(() => assertAuthConfiguration({ NODE_ENV: "not-real" })).toThrowError(
      EnvironmentConfigurationError,
    );
  });
});
