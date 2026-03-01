import { defineConfig } from "@playwright/test";

const STORYBOOK_PORT = 6006;
const STORYBOOK_URL = `http://127.0.0.1:${STORYBOOK_PORT}`;

export default defineConfig({
  testDir: "./src/storybook",
  testMatch: ["**/*.visual.spec.ts"],
  timeout: 30_000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: STORYBOOK_URL,
    headless: true,
    viewport: {
      width: 1280,
      height: 900,
    },
    deviceScaleFactor: 1,
    screenshot: "off",
  },
  webServer: {
    command: `bunx storybook dev -p ${STORYBOOK_PORT} --ci --config-dir .storybook`,
    cwd: process.cwd(),
    url: STORYBOOK_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
