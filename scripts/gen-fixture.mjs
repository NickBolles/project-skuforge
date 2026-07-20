import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCatalog } from "../test/fixtures/gen-catalog.ts";

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const variants = Number(readArgument("--variants", "120"));
const seed = Number(readArgument("--seed", String(0x5f3759df)));
if (!Number.isSafeInteger(variants) || variants < 1) {
  throw new Error("--variants must be a positive safe integer");
}
if (!Number.isSafeInteger(seed)) {
  throw new Error("--seed must be a safe integer");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(scriptDirectory, `../test/fixtures/catalog-${variants}.json`);
const output = resolve(readArgument("--output", defaultOutput));
const catalog = generateCatalog({ variants, seed });

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Generated ${catalog.length} variants at ${output}`);
