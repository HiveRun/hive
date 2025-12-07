import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { z } from "zod";
import { hiveConfigSchema } from "../../apps/server/src/config/schema";

const configInput: z.input<typeof hiveConfigSchema> = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "big-pickle",
  },
  promptSources: ["docs/prompts/**/*.md"],
  defaults: {
    templateId: "hive-dev",
  },
  templates: {
    "hive-dev": {
      id: "hive-dev",
      label: "Hive Development Environment",
      type: "manual",
      includePatterns: [".env*", "vendor/**"],
      ignorePatterns: ["node_modules/**", ".hive/**", ".turbo/**"],
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
      includePatterns: [".env*", "*.db", "vendor/**"],
      ignorePatterns: ["node_modules/**", ".hive/**", ".turbo/**"],
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
      includePatterns: [".env*", "vendor/**"],
      ignorePatterns: ["node_modules/**", ".hive/**", ".turbo/**"],
      agent: {
        providerId: "opencode",
        modelId: "big-pickle",
      },
    },
    "provider-only": {
      id: "provider-only",
      label: "Provider Only Agent",
      type: "manual",
      includePatterns: [".env*", "vendor/**"],
      ignorePatterns: ["node_modules/**", ".hive/**", ".turbo/**"],
      agent: {
        providerId: "opencode",
      },
    },
    agentless: {
      id: "agentless",
      label: "No Agent Overrides",
      type: "manual",
      includePatterns: [".env*", "vendor/**"],
      ignorePatterns: ["node_modules/**", ".hive/**", ".turbo/**"],
    },
  },
};

const config = hiveConfigSchema.parse(configInput);
const outputPath = resolve(process.cwd(), "hive.config.jsonc");

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

console.log(`Generated ${outputPath} from hiveConfigSchema`);
