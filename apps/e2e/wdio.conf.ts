import os from "node:os";
import { join } from "node:path";
import VideoReporter from "wdio-video-reporter";

const isHeaded = process.env.HIVE_E2E_HEADED === "1";
const baseUrl = process.env.HIVE_E2E_BASE_URL ?? "http://127.0.0.1:3001";
const artifactsDir =
  process.env.HIVE_E2E_ARTIFACTS_DIR ??
  join(process.cwd(), "reports", "latest");
const allureResultsDir = join(artifactsDir, "allure-results");
const videosDir = join(artifactsDir, "videos");

export const config = {
  runner: "local",
  framework: "mocha",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  logLevel: "info",
  outputDir: artifactsDir,
  baseUrl,
  mochaOpts: {
    timeout: 180_000,
  },
  reporters: [
    "spec",
    [
      VideoReporter,
      {
        saveAllVideos: true,
        videoSlowdownMultiplier: 3,
        screenshotIntervalSecs: 1,
        videoRenderTimeout: 30_000,
        outputDir: videosDir,
      },
    ],
    [
      "allure",
      {
        outputDir: allureResultsDir,
        disableWebdriverStepsReporting: true,
        disableWebdriverScreenshotsReporting: false,
        reportedEnvironmentVars: {
          os_platform: os.platform(),
          os_release: os.release(),
          os_version: os.version(),
          node_version: process.version,
        },
      },
    ],
  ],
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: [
          "--window-size=1440,900",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          ...(isHeaded ? [] : ["--headless=new"]),
        ],
      },
    },
  ],
};

export default config;
