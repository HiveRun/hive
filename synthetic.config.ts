import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  opencode: {
    defaultProvider: "zen",
    defaultModel: "big-pickle",
  },
  promptSources: ["docs/prompts/**/*.md"],
  templates: {
    "synthetic-dev": {
      id: "synthetic-dev",
      label: "Synthetic Development Environment",
      type: "manual",
      includePatterns: [".env*"],
      agent: {
        providerId: "zen",
        modelId: "big-pickle",
      },
      services: {
        web: {
          type: "process",
          run: "bun run dev",
          cwd: "./apps/web",
          env: {
            NODE_ENV: "development",
          },
          readyTimeoutMs: 3000,
        },
        server: {
          type: "process",
          run: "bun run dev",
          cwd: "./apps/server",
          env: {
            NODE_ENV: "development",
            DATABASE_URL: "./dev.db",
          },
          readyTimeoutMs: 5000,
        },
      },
    },
    "web-api": {
      id: "web-api",
      label: "Web API Server",
      type: "manual",
      includePatterns: [".env*", "*.db"],
      agent: {
        providerId: "zen",
        modelId: "big-pickle",
      },
      services: {
        api: {
          type: "process",
          run: "bun run dev",
          cwd: "./api",
          env: {
            NODE_ENV: "development",
          },
          readyTimeoutMs: 5000,
        },
      },
    },
    basic: {
      id: "basic",
      label: "Basic Template",
      type: "manual",
      includePatterns: [".env*"],
      agent: {
        providerId: "zen",
        modelId: "big-pickle",
      },
    },
  },
});
