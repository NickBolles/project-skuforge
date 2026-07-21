import { describe, expect, it } from "vitest";
import { loader } from "../app/routes/healthz";

describe("healthz route", () => {
  it("reports process liveness without depending on application services", async () => {
    const response = loader();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "skuforge" });
  });
});
