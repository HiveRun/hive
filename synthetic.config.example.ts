import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  opencode: {
    defaultProvider: "zen",
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
      timeoutMs: 90_000,
      // baseUrl: "http://localhost:11434/v1", // Uncomment for local OpenAI-compatible hosts
    },
  },
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
