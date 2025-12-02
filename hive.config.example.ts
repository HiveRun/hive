import { defineHiveConfig } from "./apps/server/src/config/schema";

export default defineHiveConfig({
  opencode: {
    defaultProvider: "zen",
    defaultModel: "big-pickle",
  },
  promptSources: ["docs/prompts/**/*.md"],
  templates: {
    basic: {
      id: "basic",
      label: "Basic Template",
      type: "manual",
      includePatterns: [".env*"],
      agent: {
        providerId: "zen",
        modelId: "big-pickle",
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
