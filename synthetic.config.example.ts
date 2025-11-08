import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  opencode: {
    workspaceId: "workspace_123",
    token: process.env.OPENCODE_TOKEN,
    defaultProvider: "openai",
    defaultModel: "gpt-5-codex-high",
  },
  promptSources: ["docs/prompts/**/*.md"],
  templates: {
    basic: {
      id: "basic",
      label: "Basic Template",
      type: "manual",
      includePatterns: [".env*"],
      agent: {
        providerId: "openai",
        modelId: "gpt-5-codex-high",
      },
      services: {
        api: {
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
  },
});
