import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

const bridgeTarget = process.env.HERDR_WEB_BRIDGE ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, "local-deps/**"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": bridgeTarget,
      "/ws": {
        target: bridgeTarget,
        ws: true,
      },
    },
  },
});
