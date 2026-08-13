import { availableParallelism } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const isHeaded = process.env.HIVE_E2E_HEADED === "1";
const isAndroidE2e = process.env.HIVE_E2E_ANDROID === "1";
const baseURL = process.env.HIVE_E2E_BASE_URL ?? "http://127.0.0.1:3001";
const artifactsDir =
  process.env.HIVE_E2E_ARTIFACTS_DIR ??
  join(process.cwd(), "reports", "latest");
const FAST_WORKER_MIN = 2;
const FAST_WORKER_MAX = 4;
const DEFAULT_TEST_TIMEOUT_MS = 180_000;
const ANDROID_TEST_TIMEOUT_MS = 1_200_000;
const workers = resolveWorkerCount({
  configuredValue: process.env.HIVE_E2E_WORKERS,
  isCi: Boolean(process.env.CI),
});
const videoMode = resolveVideoMode(process.env.HIVE_E2E_VIDEO_MODE);

export default defineConfig({
  testDir: "./specs",
  testMatch: isAndroidE2e ? ["**/*.android.e2e.ts"] : ["**/*.e2e.ts"],
  testIgnore: isAndroidE2e ? [] : ["**/*.android.e2e.ts"],
  timeout: isAndroidE2e ? ANDROID_TEST_TIMEOUT_MS : DEFAULT_TEST_TIMEOUT_MS,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: isAndroidE2e ? 1 : workers,
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
    launchOptions: isAndroidE2e
      ? {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${process.env.HIVE_E2E_BROWSER_SPEECH_PATH}`,
          ],
        }
      : undefined,
    permissions: isAndroidE2e ? ["microphone"] : [],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: {
      mode: videoMode,
      size: { width: 1280, height: 720 },
    },
    viewport: { width: 1280, height: 720 },
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

function resolveVideoMode(value: string | undefined) {
  if (value === "off" || value === "on" || value === "retain-on-failure") {
    return value;
  }

  return "on";
}

function resolveWorkerCount(options: {
  configuredValue: string | undefined;
  isCi: boolean;
}) {
  if (options.configuredValue === "half") {
    return Math.max(1, Math.floor(availableParallelism() / 2));
  }

  if (options.configuredValue === "fast") {
    const halfWorkers = Math.max(1, Math.floor(availableParallelism() / 2));
    return Math.min(FAST_WORKER_MAX, Math.max(FAST_WORKER_MIN, halfWorkers));
  }

  const fallbackWorkers = options.isCi ? 1 : 2;
  if (!options.configuredValue) {
    return fallbackWorkers;
  }

  const configuredWorkers = Number(options.configuredValue);
  if (Number.isFinite(configuredWorkers) && configuredWorkers > 0) {
    return Math.floor(configuredWorkers);
  }

  return fallbackWorkers;
}
