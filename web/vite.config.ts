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

// `@parlay/client` is an intentionally OPTIONAL, LOCAL-ONLY, NEVER-PUBLISHED dependency.
// It resolves only when the gitignored symlink `web/local-deps/parlay-client` is present,
// which enables the parlay voice-submit path. It is deliberately absent from
// package.json/package-lock.json so `npm ci` never fetches it from a registry.
//
// Externalization is CONDITIONAL on the symlink (see build.rolldownOptions.external below):
//   - symlink present  → bundle the real @parlay/client → the parlay voice-submit path
//     ("bravely"/"gravely"/… trailing dictation submit) works in the built app, matching
//     dev/test.
//   - symlink absent   → externalize @parlay/client so `vite build` still succeeds without
//     the dep; ParlayInput's guarded `try { await import(...) }` then falls back to a plain
//     input at runtime.
//
// Externalizing UNCONDITIONALLY was the bug behind "bravely no longer submits": a production
// build emitted a 0-byte `__vite-browser-external` stub for @parlay/client with nothing serving
// it at runtime (the bridge serves a static dir, no module server), so the runtime import always
// failed and every deployed build silently shipped the plain input — voice-submit could never
// work in prod even when built with the symlink present. Do not add a registry version.

// Resolve to the package's built entry, not the bare directory. Vite's dev/build resolver would
// infer the entry from package.json, but Vitest's module runner does not resolve a directory id,
// so returning the directory left `@parlay/client` unresolvable under test — ParlayInput then
// silently took its plain-input fallback and the parlay voice-submit path went untested.
// Pointing at the entry file fixes dev, test, and (when bundled) production alike.
const parlayEntry = resolve(__dirname, "local-deps/parlay-client/dist/index.js");
const hasLocalParlay = existsSync(parlayEntry);

function parlayClientResolver(): Plugin {
  return {
    name: "parlay-client-resolver",
    resolveId(id) {
      if (id === "@parlay/client" && hasLocalParlay) {
        return parlayEntry;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), parlayClientResolver()],
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
  build: {
    rolldownOptions: {
      // Only externalize when the local symlink is absent. With the symlink present the
      // resolver above points @parlay/client at its built entry and rolldown bundles it,
      // so the parlay voice-submit path ships in the built app. Without it, externalize so
      // the build still succeeds and ParlayInput falls back to the plain input at runtime.
      external: hasLocalParlay ? [] : ["@parlay/client"],
      onwarn(warning: { message?: string }) {
        // Suppress warning for unresolved @parlay/client — it's optional.
        if (warning.message?.includes("@parlay/client")) {
          return;
        }
      },
    },
  },
});
