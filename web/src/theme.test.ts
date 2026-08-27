// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTheme, DEFAULT_THEME, nextTheme, parseTheme } from "./theme";

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

describe("applyTheme", () => {
  function makeDocument(head: string): Document {
    const doc = document.implementation.createHTMLDocument("test");
    doc.head.innerHTML = head;
    return doc;
  }

  it("marks the document root with the active theme", () => {
    const doc = makeDocument("");

    applyTheme(doc, "light");
    expect(doc.documentElement.dataset.theme).toBe("light");

    applyTheme(doc, "dark");
    expect(doc.documentElement.dataset.theme).toBe("dark");
  });

  it("retints the existing theme-color meta so the mobile browser chrome follows", () => {
    const doc = makeDocument('<meta name="theme-color" content="#11111b" />');

    applyTheme(doc, "light");
    expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#dce0e8");

    applyTheme(doc, "dark");
    expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#11111b");
  });

  it("never adds a second theme-color meta", () => {
    const doc = makeDocument('<meta name="theme-color" content="#11111b" />');

    applyTheme(doc, "light");

    expect(doc.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it("still applies the theme when the document has no theme-color meta", () => {
    const doc = makeDocument("");

    expect(() => applyTheme(doc, "light")).not.toThrow();
    expect(doc.documentElement.dataset.theme).toBe("light");
  });
});
