import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  opencode: {
    workspaceId: "synthetic-dev",
    token: process.env.OPENCODE_TOKEN,
    defaultProvider: "openai",
    defaultModel: "gpt-5-codex-high",
  },
  promptSources: ["docs/prompts/**/*.md"],
  templates: {
    "synthetic-dev": {
      id: "synthetic-dev",
      label: "Synthetic Development Environment",
      type: "manual",
      includePatterns: [".env*"],
      agent: {
        providerId: "openai",
        modelId: "gpt-5-codex-high",
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
        providerId: "openai",
        modelId: "gpt-5-codex-medium",
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
        providerId: "openai",
        modelId: "gpt-5-codex-low",
      },
    },
  },
});
