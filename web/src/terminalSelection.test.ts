import { describe, expect, it } from "vitest";
import { findFirstUrlInSelection, normalizeSelectionForUrl, openableHttpUrl } from "./terminalSelection";

describe("terminal selection helpers", () => {
  it("finds http URLs in selected terminal text", () => {
    expect(findFirstUrlInSelection("open https://example.com/path?q=1 now")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("rejoins wrapped URLs before parsing", () => {
    expect(findFirstUrlInSelection("see https://example.com/\nvery/long/path")).toBe(
      "https://example.com/very/long/path",
    );
  });

  it("trims sentence punctuation from detected URLs", () => {
    expect(findFirstUrlInSelection("done (https://example.com/test).")).toBe(
      "https://example.com/test",
    );
  });

  it("does not trim balanced URL closing delimiters", () => {
    expect(findFirstUrlInSelection("https://example.com/a_(b)")).toBe(
      "https://example.com/a_(b)",
    );
  });

  it("keeps the legacy URL normalization helper available for wrapped text", () => {
    expect(normalizeSelectionForUrl("alpha \t beta\nhttps://x.test/a")).toBe(
      "alpha betahttps://x.test/a",
    );
  });

  it("finds URLs that begin on the next selected line", () => {
    expect(findFirstUrlInSelection("alpha beta\nhttps://x.test/a")).toBe("https://x.test/a");
  });

  it("does not synthesize URLs across unrelated lines", () => {
    expect(findFirstUrlInSelection("alpha https://example.com\nnot-a-url")).toBe(
      "https://example.com",
    );
  });

  it("allows only http and https URLs to be opened", () => {
    expect(openableHttpUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(openableHttpUrl("http://example.com/path")).toBe("http://example.com/path");
    expect(openableHttpUrl("javascript:alert(1)")).toBeNull();
    expect(openableHttpUrl("data:text/html,hello")).toBeNull();
    expect(openableHttpUrl("mailto:test@example.com")).toBeNull();
    expect(openableHttpUrl("tel:+15555555555")).toBeNull();
  });
});
