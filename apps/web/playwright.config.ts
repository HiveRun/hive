import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Test Configuration
 *
 * This project uses visual snapshot testing exclusively for UI validation.
 * Configuration optimized for both human and AI agent debugging.
 *
 * Key settings:
 * - trace: "retain-on-failure" - Captures detailed traces on first failure (for AI debugging)
 * - screenshot: "only-on-failure" - Takes screenshots when tests fail
 * - Snapshots stored in: e2e/__snapshots__/ directory
 * - Test artifacts in: test-results/ (gitignored, but readable by AI agents)
 *
 * See https://playwright.dev/docs/test-configuration
 */
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const WEB_SERVER_TIMEOUT_MS = 120_000;
const API_SERVER_PORT = process.env.API_E2E_PORT ?? "3100";
const WEB_APP_PORT = process.env.WEB_E2E_PORT ?? "3101";

export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate:
    "{testDir}/__snapshots__/{testFilePath}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: Boolean(process.env.CI),
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["list"], ["html", { open: "never" }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: `http://localhost:${WEB_APP_PORT}`,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "retain-on-failure",
    /* Screenshot on failure */
    screenshot: "only-on-failure",
    /* Use a fixed browser timezone so visual snapshots are stable across machines. */
    timezoneId: "UTC",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: "bun run dev",
      url: `http://localhost:${API_SERVER_PORT}`,
      reuseExistingServer: false,
      cwd: path.join(ROOT_DIR, "apps", "server"),
      timeout: WEB_SERVER_TIMEOUT_MS,
      env: {
        PORT: API_SERVER_PORT,
        WEB_PORT: WEB_APP_PORT,
      },
    },
    {
      command: "bun run dev:e2e",
      url: `http://localhost:${WEB_APP_PORT}`,
      reuseExistingServer: false,
      cwd: path.join(ROOT_DIR, "apps", "web"),
      timeout: WEB_SERVER_TIMEOUT_MS,
      env: {
        PORT: WEB_APP_PORT,
        SERVER_PORT: API_SERVER_PORT,
      },
    },
  ],
});
