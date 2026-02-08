const isHeaded = process.env.HIVE_E2E_HEADED === "1";
const baseUrl = process.env.HIVE_E2E_BASE_URL ?? "http://127.0.0.1:3001";

export const config = {
  runner: "local",
  framework: "mocha",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  logLevel: "info",
  baseUrl,
  mochaOpts: {
    timeout: 180_000,
  },
  reporters: ["spec"],
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
