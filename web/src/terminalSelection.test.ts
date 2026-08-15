import { describe, expect, it } from "vitest";
import {
  findFirstUrlInSelection,
  normalizeMobileTerminalCopyText,
  normalizeSelectionForUrl,
  openableHttpUrl,
  selectedTextFromVisibleRows,
  terminalSelectionRange,
  terminalUrlTapTarget,
} from "./terminalSelection";

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

  it("removes a visual row boundary from a copied mobile URL", () => {
    expect(
      normalizeMobileTerminalCopyText(
        "http://100.112.72.93:8765/herdr-hollow-centered\n-handle-d872ae6.apk",
      ),
    ).toBe("http://100.112.72.93:8765/herdr-hollow-centered-handle-d872ae6.apk");
  });

  it("rejoins an alphanumeric URL continuation at the terminal right edge", () => {
    expect(
      normalizeMobileTerminalCopyText(
        "http://100.112.72.93:4100/herdr-web-rebased-v2-ab\n 689b6-android-debug.apk",
        [true],
      ),
    ).toBe("http://100.112.72.93:4100/herdr-web-rebased-v2-ab689b6-android-debug.apk");
  });

  it("rejoins an indented URL continuation when canvas row evidence is unavailable", () => {
    expect(
      normalizeMobileTerminalCopyText(
        "http://100.112.72.93:4100/herdr-web-copy-fix-v3-9\n 1c39e1.apk",
        [false],
      ),
    ).toBe("http://100.112.72.93:4100/herdr-web-copy-fix-v3-91c39e1.apk");
  });

  it("preserves an unindented alphanumeric hard line break without right-edge evidence", () => {
    expect(
      normalizeMobileTerminalCopyText(
        "http://100.112.72.93:4100/herdr-web-rebased-v2-ab\n689b6-android-debug.apk",
        [false],
      ),
    ).toBe("http://100.112.72.93:4100/herdr-web-rebased-v2-ab\n689b6-android-debug.apk");
  });

  it("preserves an indented prose word after a URL", () => {
    expect(
      normalizeMobileTerminalCopyText("https://example.com/release\n Next", [false]),
    ).toBe("https://example.com/release\n Next");
  });

  it("preserves copied prose line boundaries and spaces", () => {
    expect(normalizeMobileTerminalCopyText("first line\nsecond line with spaces", [true])).toBe(
      "first line\nsecond line with spaces",
    );
  });

  it("preserves a hard line boundary after a complete URL", () => {
    expect(normalizeMobileTerminalCopyText("https://example.com/release\nNext step")).toBe(
      "https://example.com/release\nNext step",
    );
  });

  it("preserves a hard line boundary before list prose", () => {
    expect(normalizeMobileTerminalCopyText("https://example.com/release/\n- Next step", [true])).toBe(
      "https://example.com/release/\n- Next step",
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

  it("opens tapped terminal URLs only when mouse tracking is inactive", () => {
    expect(terminalUrlTapTarget("https://example.com/path", false)).toBe(
      "https://example.com/path",
    );
    expect(terminalUrlTapTarget("https://example.com/path", true)).toBeNull();
    expect(terminalUrlTapTarget("mailto:test@example.com", false)).toBeNull();
    expect(terminalUrlTapTarget(null, false)).toBeNull();
  });

  it("orders forward and backward terminal selection ranges", () => {
    expect(terminalSelectionRange({ col: 2, row: 1 }, { col: 5, row: 3 }, 10)).toEqual({
      from: { col: 2, row: 1 },
      to: { col: 5, row: 3 },
      length: 24,
    });
    expect(terminalSelectionRange({ col: 5, row: 3 }, { col: 2, row: 1 }, 10)).toEqual({
      from: { col: 2, row: 1 },
      to: { col: 5, row: 3 },
      length: 24,
    });
  });

  it("extracts selected text from visible terminal rows", () => {
    const rows = [
      "scrollback hidden",
      "alpha visible   ",
      "bravo visible   ",
      "charlie visible ",
    ];
    expect(selectedTextFromVisibleRows(rows, { col: 6, row: 1 }, { col: 6, row: 3 }, 16)).toBe(
      "visible\nbravo visible\ncharlie",
    );
  });

  it("extracts selected text for backward drags", () => {
    const rows = ["zero line", "alpha visible", "bravo visible", "charlie visible"];
    expect(selectedTextFromVisibleRows(rows, { col: 6, row: 3 }, { col: 6, row: 1 }, 16)).toBe(
      "visible\nbravo visible\ncharlie",
    );
  });

  it("extracts a single character for same-cell selections", () => {
    expect(selectedTextFromVisibleRows(["alpha"], { col: 1, row: 0 }, { col: 1, row: 0 }, 10)).toBe(
      "l",
    );
  });
});
