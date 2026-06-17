import { describe, expect, it } from "vitest";
import {
  findFirstUrlInSelection,
  normalizeSelectionForUrl,
  openableHttpUrl,
  selectedTextFromVisibleRows,
  terminalSelectionRange,
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

  it("ignores single-cell selections to match terminal hasSelection behavior", () => {
    expect(selectedTextFromVisibleRows(["alpha"], { col: 1, row: 0 }, { col: 1, row: 0 }, 10)).toBe(
      "",
    );
  });
});
