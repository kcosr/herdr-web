import { describe, expect, it } from "vitest";
import { parlayEntryCandidates } from "../vite.config";

describe("parlayEntryCandidates", () => {
  it("falls back to dist/index.js when there is no package.json", () => {
    expect(parlayEntryCandidates(undefined)).toEqual(["dist/index.js"]);
  });

  it("falls back to dist/index.js when no entry field is declared", () => {
    expect(parlayEntryCandidates({ name: "@parlay/client" })).toEqual(["dist/index.js"]);
  });

  it("reads a string exports field", () => {
    expect(parlayEntryCandidates({ exports: "./dist/index.mjs" })).toEqual([
      "dist/index.mjs",
      "dist/index.js",
    ]);
  });

  it("reads the root subpath of an exports map", () => {
    expect(
      parlayEntryCandidates({ exports: { ".": "./dist/index.mjs", "./x": "./dist/x.js" } }),
    ).toEqual(["dist/index.mjs", "dist/index.js"]);
  });

  it("reads conditional exports, browser before import", () => {
    expect(
      parlayEntryCandidates({
        exports: { ".": { import: "./dist/index.mjs", browser: "./dist/browser.js" } },
      }),
    ).toEqual(["dist/browser.js", "dist/index.mjs", "dist/index.js"]);
  });

  it("reads nested conditional exports", () => {
    expect(
      parlayEntryCandidates({ exports: { ".": { import: { default: "./dist/index.mjs" } } } }),
    ).toEqual(["dist/index.mjs", "dist/index.js"]);
  });

  it("treats a condition map without a '.' key as the root export", () => {
    expect(parlayEntryCandidates({ exports: { import: "./dist/index.mjs" } })).toEqual([
      "dist/index.mjs",
      "dist/index.js",
    ]);
  });

  it("prefers exports, then module, then main, then the fallback", () => {
    expect(
      parlayEntryCandidates({
        exports: { ".": "./dist/index.mjs" },
        module: "./dist/index.esm.js",
        main: "./dist/index.cjs",
      }),
    ).toEqual(["dist/index.mjs", "dist/index.esm.js", "dist/index.cjs", "dist/index.js"]);
  });

  it("accepts a bare main path, the common package.json form", () => {
    expect(parlayEntryCandidates({ main: "dist/index.mjs" })).toEqual([
      "dist/index.mjs",
      "dist/index.js",
    ]);
  });

  it("accepts a bare module path", () => {
    expect(parlayEntryCandidates({ module: "dist/esm/client.js" })).toEqual([
      "dist/esm/client.js",
      "dist/index.js",
    ]);
  });

  it("accepts a top-level bare main", () => {
    expect(parlayEntryCandidates({ main: "index.js" })).toEqual(["index.js", "dist/index.js"]);
  });

  it("does not duplicate a declared entry that matches the fallback", () => {
    expect(parlayEntryCandidates({ main: "./dist/index.js" })).toEqual(["dist/index.js"]);
    expect(parlayEntryCandidates({ main: "dist/index.js" })).toEqual(["dist/index.js"]);
  });

  it("rejects absolute and escaping main paths", () => {
    expect(parlayEntryCandidates({ main: "/abs/dist/index.mjs" })).toEqual(["dist/index.js"]);
    expect(parlayEntryCandidates({ main: "C:\\abs\\index.js" })).toEqual(["dist/index.js"]);
    expect(parlayEntryCandidates({ main: "../outside/index.js" })).toEqual(["dist/index.js"]);
  });

  it("ignores non-string entry values", () => {
    expect(parlayEntryCandidates({ module: 42 })).toEqual(["dist/index.js"]);
    expect(parlayEntryCandidates({ exports: ["./dist/index.mjs"] })).toEqual(["dist/index.js"]);
  });

  it("still requires the './' prefix for exports targets", () => {
    expect(parlayEntryCandidates({ exports: { ".": "dist/index.mjs" } })).toEqual([
      "dist/index.js",
    ]);
  });
});
