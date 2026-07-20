import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeSchema,
  schemasAreInSync,
} from "../../scripts/check-schema-sync.mjs";

describe("dual Prisma schemas", () => {
  it("keeps SQLite and Postgres models identical", async () => {
    await expect(
      schemasAreInSync(
        resolve("prisma/schema.prisma"),
        resolve("prisma/schema.postgres.prisma"),
      ),
    ).resolves.toBe(true);
  });

  it("ignores only provider-specific datasource configuration", () => {
    expect(
      normalizeSchema('datasource db {\n provider = "sqlite"\n}\nmodel A { id String @id }'),
    ).toBe(
      normalizeSchema(
        'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\nmodel A { id String @id }',
      ),
    );
    expect(normalizeSchema("model A { id String @id }\n")).not.toBe(
      normalizeSchema("model A { id Int @id }\n"),
    );
  });
});
