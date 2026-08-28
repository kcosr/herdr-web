// Production-composition contracts (project-9q9): drive the REAL herdr-web
// served by the live bridge at iPhone Pro Max size using its own deep-link
// params (?bridge=&pane=&workspace=), then measure actual layout.
//
// Read-only by default. Typing into a live pane's staged input requires
// HERDR_WEB_SAFE_TYPING=1 (staged text sends only on explicit send).

import { test, expect } from "@playwright/test";

const BASE = process.env.HERDR_WEB_URL ?? "http://localhost:8787";
const BRIDGE = process.env.HERDR_BRIDGE_ID ?? "same-origin";
const PANE = process.env.HERDR_PANE_ID ?? "";
const WORKSPACE = process.env.HERDR_WORKSPACE_ID ?? "";
const VIEWPORT = { width: 430, height: 932 };

test.describe.configure({ mode: "serial" });
test.use({ viewport: VIEWPORT, hasTouch: true, isMobile: true });

function targetUrl(withGrowth = false): string {
  const params = new URLSearchParams({ bridge: BRIDGE });
  if (PANE) params.set("pane", PANE);
  if (WORKSPACE) params.set("workspace", WORKSPACE);
  if (withGrowth) params.set("vspacegrow", "1");
  return `${BASE}/?${params.toString()}`;
}

async function typeGrowth(page: import("@playwright/test").Page) {
  if (process.env.HERDR_WEB_SAFE_TYPING !== "1") return;
  const input = page.locator(".term-native-input").first();
  if ((await input.count()) === 0) return;
  await input.click();
  await input.type("grow ".repeat(160), { delay: 1 });
}

// Mobile switcher flow: Tabs section -> first agent/pane row -> detail mounts
// (deep-link params seed selection but openMobileDetail fires only on real
// pane selection). Click-based: the rows use useLongPress for menus while a
// plain click maps to onSelect.
async function ensurePaneMounted(page: import("@playwright/test").Page) {
  const host = page.locator(".terminal-host").first();
  if ((await host.count()) > 0 && (await host.isVisible())) return true;
  await page.getByRole("button", { name: "Tabs", exact: true }).first().click();
  const row = page.locator(".pane-row.agent-row").first();
  await row.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  if ((await row.count()) === 0) return false;
  await row.click();
  await page.locator(".terminal-host").first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  return await page.locator(".terminal-host").first().isVisible();
}

test("app renders against the live bridge", async ({ page }) => {
  await page.goto(targetUrl(), { waitUntil: "domcontentloaded" });
  await expect(page.locator(".stage").first()).toBeVisible({ timeout: 15_000 });
});

test("baseline: terminal host occupies >= 50% of viewport", async ({ page }) => {
  await page.goto(targetUrl(), { waitUntil: "domcontentloaded" });
  if (!(await ensurePaneMounted(page))) test.skip(true, "no pane selectable");
  const host = page.locator(".terminal-host").first();
  const box = await host.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  const visible = Math.max(
    0,
    Math.min(box.y + box.height, VIEWPORT.height) - Math.max(box.y, 0),
  );
  expect(visible).toBeGreaterThanOrEqual(VIEWPORT.height * 0.5);
});

test("baseline: composer height stays within 34% of viewport", async ({ page }) => {
  await page.goto(targetUrl(), { waitUntil: "domcontentloaded" });
  if (!(await ensurePaneMounted(page))) test.skip(true, "no pane selectable");
  const input = page.locator(".term-native-input").first();
  if (!(await input.isVisible().catch(() => false))) {
    // Mobile focus flow: tapping the terminal reveals the command composer.
    await page.locator(".terminal-host").first().tap();
    await page.waitForTimeout(600);
  }
  const box = await input.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  // Bottom-docked bar: bound its HEIGHT (how far it rises), not its bottom edge.
  expect(box.height).toBeLessThanOrEqual(VIEWPORT.height * 0.34);
});

test("growth: typed text keeps composer within bounds (safe-typing)", async ({ page }) => {
  test.skip(process.env.HERDR_WEB_SAFE_TYPING !== "1", "set HERDR_WEB_SAFE_TYPING=1");
  await page.goto(targetUrl(), { waitUntil: "domcontentloaded" });
  if (!(await ensurePaneMounted(page))) test.skip(true, "no pane selectable");
  const input = page.locator(".term-native-input").first();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.type("grow ".repeat(160), { delay: 1 });
  await page.waitForTimeout(300);
  const box = await input.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  // Growth cap from fixture contracts: <= 34% of viewport height.
  expect(box.height).toBeLessThanOrEqual(VIEWPORT.height * 0.34);
  const hostBox = await page.locator(".terminal-host").first().boundingBox();
  if (hostBox) {
    const visible = Math.max(
      0,
      Math.min(hostBox.y + hostBox.height, VIEWPORT.height) - Math.max(hostBox.y, 0),
    );
    expect(visible).toBeGreaterThanOrEqual(200);
  }
});
