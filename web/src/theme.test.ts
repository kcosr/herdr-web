import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, nextTheme, parseTheme } from "./theme";

describe("parseTheme", () => {
  it("accepts light", () => {
    expect(parseTheme("light")).toBe("light");
  });

  it("falls back to the default for anything else", () => {
    expect(parseTheme("dark")).toBe(DEFAULT_THEME);
    expect(parseTheme(undefined)).toBe(DEFAULT_THEME);
    expect(parseTheme(null)).toBe(DEFAULT_THEME);
    expect(parseTheme(42)).toBe(DEFAULT_THEME);
  });
});

describe("nextTheme", () => {
  it("toggles between dark and light", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });
});
