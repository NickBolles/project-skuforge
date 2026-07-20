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
  },
});
