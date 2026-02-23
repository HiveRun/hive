import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const artifactsDir =
  process.env.HIVE_E2E_ARTIFACTS_DIR ??
  join(process.cwd(), "reports", "latest");

export default defineConfig({
  testDir: "./specs",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: join(artifactsDir, "playwright-report") }],
  ],
  outputDir: join(artifactsDir, "test-results"),
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
