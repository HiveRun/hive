import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  templates: {
    "synthetic-dev": {
      id: "synthetic-dev",
      label: "Synthetic Development Environment",
      type: "manual",
      services: {
        web: {
          type: "process",
          run: "bun run dev",
          cwd: "./apps/web",
          env: {
            NODE_ENV: "development",
            PORT: "5173",
          },
          readyTimeoutMs: 3000,
        },
        server: {
          type: "process",
          run: "bun run dev",
          cwd: "./apps/server",
          env: {
            NODE_ENV: "development",
            PORT: "3000",
            DATABASE_URL: "./dev.db",
          },
          readyTimeoutMs: 5000,
        },
      },
      ports: [
        { name: "WEB_PORT", service: "web", port: 5173 },
        { name: "API_PORT", service: "server", port: 3000 },
      ],
    },
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
