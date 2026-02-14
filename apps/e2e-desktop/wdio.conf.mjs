import { join } from "node:path";

const artifactsDir =
  process.env.HIVE_E2E_ARTIFACTS_DIR ??
  join(process.cwd(), "reports", "latest");
const driverHostname = process.env.HIVE_E2E_DRIVER_HOST ?? "127.0.0.1";
const driverPort = Number(process.env.HIVE_E2E_DRIVER_PORT ?? "4444");
const desktopBinaryPath = process.env.HIVE_E2E_DESKTOP_BINARY;
const desktopBaseUrl =
  process.env.HIVE_E2E_DESKTOP_BASE_URL ?? "tauri://localhost";

if (!desktopBinaryPath) {
  throw new Error("HIVE_E2E_DESKTOP_BINARY is required for desktop E2E");
}

export const config = {
  runner: "local",
  hostname: driverHostname,
  port: driverPort,
  path: "/",
  baseUrl: desktopBaseUrl,
  specs: ["./specs/**/*.e2e.mjs"],
  maxInstances: 1,
  outputDir: join(artifactsDir, "wdio-logs"),
  logLevel: "info",
  reporters: ["spec"],
  framework: "mocha",
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: "bdd",
    timeout: 180_000,
  },
  capabilities: [
    {
      "wdio:maxInstances": 1,
      "tauri:options": {
        application: desktopBinaryPath,
      },
    },
  ],
};
