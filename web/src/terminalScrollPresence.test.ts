import { describe, expect, it } from "vitest";
import {
  advanceTerminalScrollOffset,
  isTerminalScrolledAwayFromPresent,
} from "./terminalScrollPresence";

describe("terminal scroll presence", () => {
  it("grows the offset when scrolling up (negative lines)", () => {
    expect(advanceTerminalScrollOffset(0, -5)).toBe(5);
    expect(advanceTerminalScrollOffset(5, -3)).toBe(8);
  });

  it("shrinks the offset when scrolling down (positive lines)", () => {
    expect(advanceTerminalScrollOffset(8, 3)).toBe(5);
  });

  it("clamps the offset at zero rather than going negative", () => {
    expect(advanceTerminalScrollOffset(2, 10)).toBe(0);
    expect(advanceTerminalScrollOffset(0, 10)).toBe(0);
  });

  it("ignores zero or non-finite deltas", () => {
    expect(advanceTerminalScrollOffset(4, 0)).toBe(4);
    expect(advanceTerminalScrollOffset(4, Number.NaN)).toBe(4);
  });

  it("reports scrolled-away only when the offset is above zero", () => {
    expect(isTerminalScrolledAwayFromPresent(0)).toBe(false);
    expect(isTerminalScrolledAwayFromPresent(1)).toBe(true);
  });

  it("returns to present after scrolling back down by exactly what was scrolled up", () => {
    let offset = 0;
    for (const delta of [-20, -20, -5]) {
      offset = advanceTerminalScrollOffset(offset, delta);
    }
    expect(isTerminalScrolledAwayFromPresent(offset)).toBe(true);
    offset = advanceTerminalScrollOffset(offset, 45);
    expect(offset).toBe(0);
    expect(isTerminalScrolledAwayFromPresent(offset)).toBe(false);
  });
});
