import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  templates: {
    "web-api": {
      id: "web-api",
      label: "Web API Server",
      type: "manual",
      services: {
        api: {
          type: "process",
          run: "bun run dev",
          cwd: "./api",
          env: {
            PORT: "3000",
            NODE_ENV: "development",
          },
          readyTimeoutMs: 5000,
        },
      },
      ports: [{ name: "API_PORT" }],
    },
    basic: {
      id: "basic",
      label: "Basic Template",
      type: "manual",
    },
  },
});
