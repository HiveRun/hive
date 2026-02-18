import type { HiveConfig } from "../../apps/server/src/config/schema";

const defaultIgnorePatterns = [
  "node_modules/**",
  ".hive/**",
  ".turbo/**",
  "tmp/**",
  "temp/**",
  ".cache/**",
  "coverage/**",
  "dist/**",
  "build/**",
  "dist-electron/**",
  "apps/server/server/**",
  "src-tauri/target/**",
];

export const hiveConfigDefaults: HiveConfig = {
  promptSources: ["docs/prompts/**/*.md"],
  defaults: {
    templateId: "hive-dev",
  },
  templates: {
    "hive-dev": {
      id: "hive-dev",
      label: "Hive Development Environment",
      type: "manual",
      includePatterns: ["./.env*", "./apps/server/.env*", "./apps/web/.env*"],
      ignorePatterns: defaultIgnorePatterns,
      env: {
        DATABASE_URL: "local.db",
      },
      setup: ["bun setup"],
      services: {
        web: {
          type: "process",
          run: "bun run dev -- --port $PORT --host 0.0.0.0",
          cwd: "./apps/web",
          env: {
            NODE_ENV: "development",
            VITE_API_URL: "http://localhost:$PORT:server",
          },
          readyTimeoutMs: 3000,
        },
        server: {
          type: "process",
          run: "bun run dev",
          cwd: "./apps/server",
          readyTimeoutMs: 5000,
          env: {
            DATABASE_URL: "local.db",
            CORS_ORIGIN:
              "http://localhost:$PORT:web,http://127.0.0.1:$PORT:web",
          },
        },
      },
    },
    "web-api": {
      id: "web-api",
      label: "Web API Server",
      type: "manual",
      includePatterns: ["./.env*", "./api/.env*"],
      ignorePatterns: defaultIgnorePatterns,
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
      includePatterns: ["./.env*"],
      ignorePatterns: defaultIgnorePatterns,
    },
    "provider-only": {
      id: "provider-only",
      label: "Provider Only Agent",
      type: "manual",
      includePatterns: ["./.env*"],
      ignorePatterns: defaultIgnorePatterns,
      agent: {
        providerId: "opencode",
      },
    },
    agentless: {
      id: "agentless",
      label: "No Agent Overrides",
      type: "manual",
      includePatterns: ["./.env*"],
      ignorePatterns: defaultIgnorePatterns,
    },
  },
};
