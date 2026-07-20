import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeSchema(schema) {
  return schema
    .replace(/datasource\s+db\s*\{[\s\S]*?\}/m, "datasource db { PROVIDER_SPECIFIC }")
    .replace(/\r\n/g, "\n")
    .trim();
}

export async function schemasAreInSync(sqlitePath, postgresPath) {
  const [sqlite, postgres] = await Promise.all([
    readFile(sqlitePath, "utf8"),
    readFile(postgresPath, "utf8"),
  ]);
  return normalizeSchema(sqlite) === normalizeSchema(postgres);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), "..");
  const sqlitePath = resolve(root, "prisma/schema.prisma");
  const postgresPath = resolve(root, "prisma/postgres/schema.prisma");
  if (!(await schemasAreInSync(sqlitePath, postgresPath))) {
    console.error("Prisma schemas differ outside their datasource blocks.");
    process.exitCode = 1;
  } else {
    console.log("Prisma SQLite and Postgres models are in sync.");
  }
}
