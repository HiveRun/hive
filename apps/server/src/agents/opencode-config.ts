import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ServerOptions } from "@opencode-ai/sdk";

const WORKSPACE_CONFIG_CANDIDATES = [
  "@opencode.json",
  "opencode.json",
] as const;

const HIVE_INSTRUCTIONS_PATH = ".hive/instructions.md";
const HIVE_THEME_NAME = "hive-resonant";

type OpencodeServerConfig = NonNullable<ServerOptions["config"]>;

type DefaultModel = {
  providerId?: string;
  modelId?: string;
};

export type LoadedOpencodeConfig = {
  config: OpencodeServerConfig;
  source: "workspace" | "default";
  details?: string;
  defaultModel?: DefaultModel;
};

function withHiveInstructions(
  config: OpencodeServerConfig
): OpencodeServerConfig {
  const existing = Array.isArray(config.instructions)
    ? config.instructions
    : [];
  if (existing.includes(HIVE_INSTRUCTIONS_PATH)) {
    return config;
  }
  return {
    ...config,
    instructions: [...existing, HIVE_INSTRUCTIONS_PATH],
  };
}

function withHiveTheme(config: OpencodeServerConfig): OpencodeServerConfig {
  if (typeof config.theme === "string" && config.theme.trim().length > 0) {
    return config;
  }

  return {
    ...config,
    theme: HIVE_THEME_NAME,
  };
}

function withHiveDefaults(config: OpencodeServerConfig): OpencodeServerConfig {
  return withHiveTheme(withHiveInstructions(config));
}

export async function loadOpencodeConfig(
  workspaceRootPath: string
): Promise<LoadedOpencodeConfig> {
  const fileConfig = await readWorkspaceConfig(workspaceRootPath);
  if (fileConfig) {
    const configWithHive = withHiveDefaults(fileConfig);
    const defaultModel = extractDefaultModel(configWithHive);
    return {
      config: configWithHive,
      source: "workspace",
      ...(defaultModel ? { defaultModel } : {}),
    };
  }

  const fallback: OpencodeServerConfig = withHiveDefaults({});
  const fallbackDefaultModel = extractDefaultModel(fallback);
  return {
    config: fallback,
    source: "default",
    ...(fallbackDefaultModel ? { defaultModel: fallbackDefaultModel } : {}),
  };
}

async function readWorkspaceConfig(
  workspaceRootPath: string
): Promise<OpencodeServerConfig | undefined> {
  for (const filename of WORKSPACE_CONFIG_CANDIDATES) {
    const configPath = join(workspaceRootPath, filename);
    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      assertIsOpencodeConfig(parsed, configPath);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        continue;
      }
      throw new Error(
        `Failed to read OpenCode config from ${configPath}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  return;
}

function assertIsOpencodeConfig(
  value: unknown,
  source: string
): asserts value is OpencodeServerConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`OpenCode config at ${source} must be an object`);
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.model !== undefined && typeof candidate.model !== "string") {
    throw new Error(
      `OpenCode config at ${source} has invalid "model" (expected string)`
    );
  }

  if (
    candidate.provider !== undefined &&
    (typeof candidate.provider !== "object" || candidate.provider === null)
  ) {
    throw new Error(
      `OpenCode config at ${source} has invalid "provider" (expected object)`
    );
  }
}

function extractDefaultModel(
  config: OpencodeServerConfig
): DefaultModel | undefined {
  const raw = typeof config.model === "string" ? config.model.trim() : "";
  if (!raw) {
    return;
  }

  const [providerId, modelId] = raw.split("/", 2);
  if (modelId) {
    const defaultModel: DefaultModel = { modelId };
    if (providerId) {
      defaultModel.providerId = providerId;
    }
    return defaultModel;
  }

  if (providerId) {
    return { modelId: providerId };
  }

  return;
}
