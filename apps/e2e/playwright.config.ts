import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const isHeaded = process.env.HIVE_E2E_HEADED === "1";
const baseURL = process.env.HIVE_E2E_BASE_URL ?? "http://127.0.0.1:3001";
const artifactsDir =
  process.env.HIVE_E2E_ARTIFACTS_DIR ??
  join(process.cwd(), "reports", "latest");

export default defineConfig({
  testDir: "./specs",
  testMatch: ["**/*.e2e.ts"],
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: join(artifactsDir, "playwright-report"),
      },
    ],
  ],
  outputDir: join(artifactsDir, "test-results"),
  use: {
    actionTimeout: 15_000,
    baseURL,
    headless: !isHeaded,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: {
      mode: "on",
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
});
