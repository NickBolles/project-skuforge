import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths({ root: process.cwd() })],
  test: {
    environment: "node",
    env: {
      AUTH_MODE: "mock",
      MOCK_PLAN: "premium",
    },
    include: ["test/**/*.test.ts", "app/**/*.test.ts"],
    restoreMocks: true,
    // Every test file shares the single prisma/dev.sqlite database (the datasource
    // URL is hardcoded in prisma/schema.prisma), so parallel workers see each
    // other's rows. That produced nondeterministic failures — a different file
    // each run — in rules-routes, entitlement-routes, and generation tests.
    // Running files serially costs ~10s and makes the suite deterministic.
    // To restore parallelism, give each worker its own SQLite file first.
    fileParallelism: false,
  },
});
