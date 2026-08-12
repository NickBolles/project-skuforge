import { describe, expect, it, vi } from "vitest";

// vi.hoisted keeps the spy above the hoisted vi.mock factory. A plain top-level
// `const` is initialized after the factory runs, which throws a TDZ error and
// makes the whole file fail to load (silently: it contributes zero tests).
const { queryRawUnsafe } = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }));

vi.mock("../../app/db.server", () => ({
  default: { $queryRawUnsafe: queryRawUnsafe },
}));

import { loader } from "../../app/routes/healthz";

describe("healthz route", () => {
  it("reports healthy when the database responds", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ "?column?": 1 }]);

    const response = await loader();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "web" });
  });

  it("reports unavailable when the database query fails", async () => {
    queryRawUnsafe.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await loader();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, service: "web" });
  });
});
