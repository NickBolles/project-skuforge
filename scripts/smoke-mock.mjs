import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 3017;
const child = spawn(
  process.execPath,
  ["node_modules/@react-router/dev/bin.js", "dev", "--port", String(port)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTH_MODE: "mock",
      SKUFORGE_SKIP_DEP_OPTIMIZE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

try {
  let response;
  let lastBody = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      response = await fetch(`http://localhost:${port}/app`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) break;
      lastBody = await response.text();
      await delay(250);
    } catch {
      await delay(250);
    }
  }

  if (!response?.ok) {
    throw new Error(`Mock server did not become ready.\n${output}\n${lastBody}`);
  }

  const html = await response.text();
  for (const expected of [
    "dev-shop.myshopify.test",
    "Plan: <!-- -->free",
    "Catalog variants: <!-- -->120",
  ]) {
    if (!html.includes(expected)) {
      throw new Error(`Mock response omitted ${expected}.`);
    }
  }

  console.log("Mock /app smoke passed: shop, free plan, and 120 variants rendered.");
} finally {
  child.kill();
}
