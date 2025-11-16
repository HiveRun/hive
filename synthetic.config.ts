import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "big-pickle",
  },
  promptSources: ["docs/prompts/**/*.md"],
  voice: {
    enabled: true,
    transcription: {
      mode: "remote",
      provider: "openai",
      model: "whisper-1",
      language: "en",
      apiKeyEnv: "OPENAI_API_KEY",
      // baseUrl: "http://localhost:11434/v1",
    },
  },
  defaults: {
    templateId: "synthetic-dev",
  },
  templates: {
    "synthetic-dev": {
      id: "synthetic-dev",
      label: "Synthetic Development Environment",
      type: "manual",
      includePatterns: [".env*"],
      agent: {
        providerId: "opencode",
        modelId: "big-pickle",
      },
      setup: ["bun setup"],
      services: {
        web: {
          type: "process",
          run: "bun run dev -- --port $PORT --host 0.0.0.0",
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
        providerId: "opencode",
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
        providerId: "opencode",
        modelId: "big-pickle",
      },
    },
  },
});
