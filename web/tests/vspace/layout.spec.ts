/**
 * Visual-space geometry contracts for the mobile input panel at 430x932
 * (iPhone Pro Max viewport). All assertions are numeric — no screenshots, no vision models.
 *
 * Contracts tested:
 *   PANEL_MAX_FRACTION  Panel height <= 50% of viewport height at all times
 *   TERMINAL_MIN_PX     Terminal area stays >= 200px tall with keyboard inset
 *   TEXTAREA_PRIORITY   Textarea width >= 50% of panel width
 *   SEND_ALWAYS_IN_VP   Send button fully inside viewport (never pushed off-screen)
 *   KEYS_COLLAPSE       Special-keys strip absent from DOM when compactControls=true
 *   TEXTAREA_BOUNDED    Expanding textarea stays within max-height CSS contract
 */
import { expect, test } from "@playwright/test";

const FIXTURE = "/vspace-test.html";
const VIEWPORT_W = 430;
const VIEWPORT_H = 932;
// Typical iOS software keyboard height on iPhone Pro Max
const KEYBOARD_INSET_PX = 291;
// Panel must never take more than half the viewport
const PANEL_MAX_FRACTION = 0.5;
// Terminal must stay at least this tall even with keyboard inset
const TERMINAL_MIN_PX = 200;
// Textarea should dominate the input row width
const TEXTAREA_MIN_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function panelRect(page: import("@playwright/test").Page) {
  return page.locator(".terminal-mobile-controls").evaluate((el: Element) =>
    el.getBoundingClientRect().toJSON(),
  );
}

async function terminalAreaRect(page: import("@playwright/test").Page) {
  return page.locator("[data-testid='terminal-area']").evaluate((el: Element) =>
    el.getBoundingClientRect().toJSON(),
  );
}

async function sendButtonRect(page: import("@playwright/test").Page) {
  // Send (submit) button: .term-send[type=submit]
  return page.locator(".term-send[type='submit']").evaluate((el: Element) =>
    el.getBoundingClientRect().toJSON(),
  );
}

async function textareaRect(page: import("@playwright/test").Page) {
  return page.locator(".term-native-input").first().evaluate((el: Element) =>
    el.getBoundingClientRect().toJSON(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Panel fraction cap", () => {
  test("panel height <= 50% of viewport at baseline (compact, no keyboard)", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector(".terminal-mobile-controls");

    const panel = await panelRect(page);
    expect(panel.height).toBeLessThanOrEqual(VIEWPORT_H * PANEL_MAX_FRACTION);
    expect(panel.height).toBeGreaterThan(0);
  });

  test("panel height <= 50% of viewport with keys row visible (compact=0)", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=0`);
    await page.waitForSelector(".terminal-mobile-controls");

    const panel = await panelRect(page);
    expect(panel.height).toBeLessThanOrEqual(VIEWPORT_H * PANEL_MAX_FRACTION);
    expect(panel.height).toBeGreaterThan(0);
  });

  test("panel height <= 50% of reduced viewport (keyboard inset simulation)", async ({ page }) => {
    const reducedH = VIEWPORT_H - KEYBOARD_INSET_PX;
    await page.setViewportSize({ width: VIEWPORT_W, height: reducedH });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector(".terminal-mobile-controls");

    const panel = await panelRect(page);
    expect(panel.height).toBeLessThanOrEqual(reducedH * PANEL_MAX_FRACTION);
    expect(panel.height).toBeGreaterThan(0);
  });
});

test.describe("Terminal visible budget", () => {
  test("terminal area >= 50% of full viewport at baseline", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector("[data-testid='terminal-area']");

    const terminal = await terminalAreaRect(page);
    expect(terminal.height).toBeGreaterThanOrEqual(VIEWPORT_H * 0.5);
  });

  test("terminal area >= 200px with keyboard inset", async ({ page }) => {
    const reducedH = VIEWPORT_H - KEYBOARD_INSET_PX;
    await page.setViewportSize({ width: VIEWPORT_W, height: reducedH });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector("[data-testid='terminal-area']");

    const terminal = await terminalAreaRect(page);
    expect(terminal.height).toBeGreaterThanOrEqual(TERMINAL_MIN_PX);
  });
});

test.describe("Send button always visible", () => {
  test("send button inside viewport at baseline", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector(".term-send[type='submit']");

    const btn = await sendButtonRect(page);
    expect(btn.height).toBeGreaterThan(0);
    expect(btn.top).toBeGreaterThanOrEqual(0);
    expect(btn.bottom).toBeLessThanOrEqual(VIEWPORT_H);
  });

  test("send button inside viewport with keyboard inset", async ({ page }) => {
    const reducedH = VIEWPORT_H - KEYBOARD_INSET_PX;
    await page.setViewportSize({ width: VIEWPORT_W, height: reducedH });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector(".term-send[type='submit']");

    const btn = await sendButtonRect(page);
    expect(btn.height).toBeGreaterThan(0);
    expect(btn.bottom).toBeLessThanOrEqual(reducedH);
  });

  test("send button inside viewport with keys row visible", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=0`);
    await page.waitForSelector(".term-send[type='submit']");

    const btn = await sendButtonRect(page);
    expect(btn.height).toBeGreaterThan(0);
    expect(btn.bottom).toBeLessThanOrEqual(VIEWPORT_H);
  });
});

test.describe("Textarea priority", () => {
  test("textarea width >= 50% of panel width (input dominates row)", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector(".term-native-input");

    const ta = await textareaRect(page);
    const panel = await panelRect(page);
    expect(ta.width).toBeGreaterThanOrEqual(panel.width * TEXTAREA_MIN_FRACTION);
  });
});

test.describe("Special-keys collapse", () => {
  test("keys strip absent from DOM when compact=1 (nonessential row collapsed)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=1`);
    await page.waitForSelector(".terminal-mobile-controls");

    const stripCount = await page.locator(".term-key-strip").count();
    expect(stripCount).toBe(0);
  });

  test("keys strip present and visible when compact=0 (keys row expanded)", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=0`);
    await page.waitForSelector(".term-key-strip");

    const strip = await page.locator(".term-key-strip").evaluate((el: Element) =>
      el.getBoundingClientRect().toJSON(),
    );
    expect(strip.height).toBeGreaterThan(0);
  });
});

test.describe("Expanding textarea bounded", () => {
  test("textarea max-height contract: does not exceed 34% viewport or 7 row heights", async ({
    page,
  }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=1&expanding=1`);
    await page.waitForSelector(".term-native-input");

    // Fill with 10 newline-separated lines to force max expansion
    const manyLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    await page.locator(".term-native-input").fill(manyLines);
    // Trigger input event so autosizeMobileCommandTextarea runs
    await page.locator(".term-native-input").dispatchEvent("input");
    await page.waitForTimeout(50);

    const ta = await textareaRect(page);
    // CSS contract: max-height = min(34vh, 7 * input-row-height)
    // At scale 1: input-row-height = 34px, so 7 * 34 = 238px
    // 34vh of 932 = 316.88px  → binding constraint is 238px
    const maxAllowedH = Math.min(VIEWPORT_H * 0.34, 7 * 34);
    // Allow a small tolerance for borders/padding
    expect(ta.height).toBeLessThanOrEqual(maxAllowedH + 4);
  });

  test("panel height <= 50% viewport even with fully expanded textarea", async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.goto(`${FIXTURE}?compact=1&expanding=1`);
    await page.waitForSelector(".term-native-input");

    const manyLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    await page.locator(".term-native-input").fill(manyLines);
    await page.locator(".term-native-input").dispatchEvent("input");
    await page.waitForTimeout(50);

    const panel = await panelRect(page);
    expect(panel.height).toBeLessThanOrEqual(VIEWPORT_H * PANEL_MAX_FRACTION);
  });
});
