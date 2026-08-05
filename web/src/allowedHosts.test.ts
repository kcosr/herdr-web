import { describe, expect, it } from "vitest";
import { parseAllowedHosts } from "../vite.config";

describe("parseAllowedHosts", () => {
  it("returns undefined when unset", () => {
    expect(parseAllowedHosts(undefined)).toBe(undefined);
  });

  it("returns undefined when empty", () => {
    expect(parseAllowedHosts("")).toBe(undefined);
    expect(parseAllowedHosts("   ")).toBe(undefined);
  });

  it("parses a single host", () => {
    expect(parseAllowedHosts("dev.example.ts.net")).toEqual(["dev.example.ts.net"]);
  });

  it("parses comma-separated hosts", () => {
    expect(parseAllowedHosts("a.example.net,b.example.net")).toEqual([
      "a.example.net",
      "b.example.net",
    ]);
  });

  it("trims surrounding whitespace from each entry", () => {
    expect(parseAllowedHosts("a.example.net, b.example.net")).toEqual([
      "a.example.net",
      "b.example.net",
    ]);
  });

  it("drops empty entries from sparse lists", () => {
    expect(parseAllowedHosts("a.example.net,,b.example.net")).toEqual([
      "a.example.net",
      "b.example.net",
    ]);
  });

  it("returns true for wildcard allow-any", () => {
    expect(parseAllowedHosts("*")).toBe(true);
  });
});
