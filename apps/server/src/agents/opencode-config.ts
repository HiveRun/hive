import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OpencodeClient, ServerOptions } from "@opencode-ai/sdk";
import { mergeHiveBrowserSafeKeybinds } from "../opencode/browser-safe-keybinds";
import { acquireSharedOpencodeClient } from "./opencode-server";

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
  variant?: string;
};

type AgentScopedConfig = {
  model?: unknown;
  variant?: unknown;
};

export type LoadedOpencodeConfig = {
  config: OpencodeServerConfig;
  source: "workspace" | "default";
  details?: string;
  defaultModel?: DefaultModel;
};

export type EffectiveOpencodeDefaults = {
  defaultModel?: DefaultModel;
  startMode?: "plan" | "build";
};

export type OpencodeModelPreferences = {
  stickyVariants: Record<string, string>;
};

function normalizeStartMode(value: unknown): "plan" | "build" | undefined {
  return value === "plan" || value === "build" ? value : undefined;
}

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

function withHiveBrowserSafeKeybinds(
  config: OpencodeServerConfig
): OpencodeServerConfig {
  const keybinds = (config as { keybinds?: unknown }).keybinds;

  return {
    ...config,
    keybinds: mergeHiveBrowserSafeKeybinds(keybinds),
  };
}

function withHiveDefaults(config: OpencodeServerConfig): OpencodeServerConfig {
  return withHiveTheme(
    withHiveInstructions(withHiveBrowserSafeKeybinds(config))
  );
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

export async function loadEffectiveOpencodeDefaults(
  workspaceRootPath: string,
  options?: { client?: Pick<OpencodeClient, "config"> }
): Promise<EffectiveOpencodeDefaults> {
  const client = options?.client ?? (await acquireSharedOpencodeClient());
  const response = await client.config.get({
    throwOnError: true,
    query: { directory: workspaceRootPath },
  });

  if (!response.data) {
    throw new Error("OpenCode server returned an empty config response");
  }

  const config = response.data as OpencodeServerConfig & {
    default_agent?: unknown;
  };

  const defaultModel = extractDefaultModel(config);
  const startMode = normalizeStartMode(config.default_agent);

  return {
    ...(defaultModel ? { defaultModel } : {}),
    ...(startMode ? { startMode } : {}),
  };
}

export async function loadOpencodeModelPreferences(): Promise<OpencodeModelPreferences> {
  const configPath = join(
    resolveOpencodeStateDirectory(),
    "opencode",
    "model.json"
  );

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as { variant?: unknown };
    const rawVariants =
      parsed && typeof parsed === "object" && parsed.variant
        ? parsed.variant
        : undefined;

    if (!rawVariants || typeof rawVariants !== "object") {
      return { stickyVariants: {} };
    }

    const stickyVariants = Object.fromEntries(
      Object.entries(rawVariants).filter(
        ([, value]) => typeof value === "string" && value !== "default"
      ) as [string, string][]
    );

    return { stickyVariants };
  } catch {
    return { stickyVariants: {} };
  }
}

function resolveOpencodeStateDirectory(): string {
  const stateHome = process.env.XDG_STATE_HOME?.trim();
  if (stateHome) {
    return stateHome;
  }

  return join(homedir(), ".local", "state");
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
  const agentDefaultModel = extractAgentDefaultModel(config);
  if (agentDefaultModel) {
    return agentDefaultModel;
  }

  const raw = typeof config.model === "string" ? config.model.trim() : "";
  if (!raw) {
    return;
  }

  const [providerId, modelId] = raw.split("/", 2);
  const variant = extractDefaultVariant(config);
  if (modelId) {
    const defaultModel: DefaultModel = { modelId };
    if (providerId) {
      defaultModel.providerId = providerId;
    }
    if (variant) {
      defaultModel.variant = variant;
    }
    return defaultModel;
  }

  if (providerId) {
    return variant ? { modelId: providerId, variant } : { modelId: providerId };
  }

  return;
}

function extractAgentDefaultModel(
  config: OpencodeServerConfig & { default_agent?: unknown }
): DefaultModel | undefined {
  const defaultAgentId =
    typeof config.default_agent === "string" ? config.default_agent : undefined;
  if (!defaultAgentId) {
    return;
  }

  const agentConfig = readAgentConfig(config, defaultAgentId);
  const rawModel =
    typeof agentConfig?.model === "string" ? agentConfig.model.trim() : "";
  if (!rawModel) {
    return;
  }

  const [providerId, modelId] = rawModel.split("/", 2);
  const variant =
    typeof agentConfig?.variant === "string" &&
    agentConfig.variant.trim().length > 0
      ? agentConfig.variant.trim()
      : undefined;

  if (modelId) {
    return {
      providerId,
      modelId,
      ...(variant ? { variant } : {}),
    };
  }

  return {
    modelId: providerId,
    ...(variant ? { variant } : {}),
  };
}

function extractDefaultVariant(
  config: OpencodeServerConfig & { default_agent?: unknown }
): string | undefined {
  const defaultAgentId =
    typeof config.default_agent === "string" ? config.default_agent : undefined;
  if (!defaultAgentId) {
    return;
  }

  const variant = readAgentVariant(config, defaultAgentId);
  return typeof variant === "string" && variant.trim().length > 0
    ? variant.trim()
    : undefined;
}

function readAgentConfig(
  config: OpencodeServerConfig,
  agentId: string
): AgentScopedConfig | undefined {
  const candidate = config as {
    agent?: Record<string, AgentScopedConfig>;
    mode?: Record<string, AgentScopedConfig>;
  };

  return candidate.agent?.[agentId] ?? candidate.mode?.[agentId];
}

function readAgentVariant(
  config: OpencodeServerConfig,
  agentId: string
): unknown {
  return readAgentConfig(config, agentId)?.variant;
}
