import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;
const hmr =
  host === "localhost"
    ? { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 }
    : {
        protocol: "wss",
        host,
        port: Number.parseInt(process.env.FRONTEND_PORT ?? "8002", 10),
        clientPort: 443,
      };

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: { preflightContinue: true },
    port: Number(process.env.PORT || 3000),
    hmr,
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [reactRouter(), tsconfigPaths({ root: process.cwd() })],
  build: { assetsInlineLimit: 0 },
  optimizeDeps: process.env.SKUFORGE_SKIP_DEP_OPTIMIZE
    ? { noDiscovery: true, include: [] }
    : { include: ["@shopify/app-bridge-react"] },
});
