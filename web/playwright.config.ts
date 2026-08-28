import { defineConfig, devices } from "@playwright/test";

/** iPhone Pro Max viewport for the visual-space harness. */
const IPHONE_PRO_MAX = { width: 430, height: 932 };

export default defineConfig({
  testDir: "./tests/vspace",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: IPHONE_PRO_MAX,
    // No screenshots — numeric assertions only.
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: IPHONE_PRO_MAX,
      },
    },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
