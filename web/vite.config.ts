import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { existsSync } from "fs";
import { resolve } from "path";

const bridgeTarget = process.env.HERDR_WEB_BRIDGE ?? "http://127.0.0.1:8787";

export function parseAllowedHosts(value: string | undefined): string[] | true | undefined {
  if (!value || value.trim() === "") return undefined;
  if (value.trim() === "*") return true;
  const hosts = value.split(",").map((h) => h.trim()).filter((h) => h.length > 0);
  return hosts.length > 0 ? hosts : undefined;
}

const allowedHosts = parseAllowedHosts(process.env.HERDR_WEB_ALLOWED_HOSTS);

// Plugin to resolve @parlay/client when available, or provide a stub when missing.
// This allows the bundle to include parlay when present, and gracefully degrade when absent.
function parlayClientPlugin(): Plugin {
  const parlayPath = resolve(__dirname, "local-deps/parlay-client");
  const isParlayCli = existsSync(parlayPath);

  return {
    name: "parlay-client-resolver",
    resolveId(id) {
      if (id === "@parlay/client") {
        if (isParlayCli) {
          // Resolve to the actual local package when available.
          return parlayPath;
        }
        // Return virtual module when parlay is missing.
        return "\0parlay-stub-client";
      }
    },
    load(id) {
      // Provide a stub module that exports empty implementations when parlay is missing.
      if (id === "\0parlay-stub-client") {
        return `
export const PARLAY_SETTINGS_DEFAULTS = { voiceSettleMs: 500 };
export async function applyEnvelope() {}
export function bumpInputVersion() {}
export function scheduleEval() {}
export function setDispatcherContext() {}
export function setEvalServerBaseUrl() {}
        `;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), parlayClientPlugin()],
  test: {
    exclude: [...configDefaults.exclude, "local-deps/**"],
    setupFiles: ["./src/testSetup.ts"],
  },
  server: {
    port: 5173,
    ...(allowedHosts !== undefined ? { allowedHosts } : {}),
    proxy: {
      "/api": bridgeTarget,
      "/ws": {
        target: bridgeTarget,
        ws: true,
      },
    },
  },
});
