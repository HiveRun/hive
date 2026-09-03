import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ConfigEntry, OpenCodeClient } from "@opencode-ai/client";
import { acquireSharedOpencodeClient } from "./opencode-server";

type ConfigDocument = Extract<ConfigEntry, { type: "document" }>;
type OpencodeServerConfig = ConfigDocument["info"];
type ModelConfig = NonNullable<OpencodeServerConfig["model"]>;

type DefaultModel = {
  providerId?: string;
  modelId?: string;
  variant?: string;
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

function latestConfigValue<K extends keyof OpencodeServerConfig>(
  entries: ConfigEntry[],
  key: K
): OpencodeServerConfig[K] | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "document" && entry.info[key] !== undefined) {
      return entry.info[key];
    }
  }
  return;
}

function parseModelConfig(
  model: ModelConfig | undefined
): DefaultModel | undefined {
  if (!model) {
    return;
  }
  if (typeof model !== "string") {
    return {
      providerId: model.providerID,
      modelId: model.model,
      ...(model.variant ? { variant: model.variant } : {}),
    };
  }

  const [reference, variant] = model.trim().split("#", 2);
  const separator = reference?.indexOf("/") ?? -1;
  if (!reference || separator < 1 || separator === reference.length - 1) {
    return;
  }
  return {
    providerId: reference.slice(0, separator),
    modelId: reference.slice(separator + 1),
    ...(variant ? { variant } : {}),
  };
}

function resolveAgentModel(
  entries: ConfigEntry[],
  agentId: string | undefined
): ModelConfig | undefined {
  if (!agentId) {
    return;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "document") {
      continue;
    }
    const model = entry.info.agents?.[agentId]?.model;
    if (model !== undefined) {
      return model;
    }
  }
  return;
}

export async function loadEffectiveOpencodeDefaults(
  workspaceRootPath: string,
  options?: { client?: Pick<OpenCodeClient, "config"> }
): Promise<EffectiveOpencodeDefaults> {
  const client = options?.client ?? (await acquireSharedOpencodeClient());
  const entries = await client.config.get({
    location: { directory: workspaceRootPath },
  });
  const defaultAgent = latestConfigValue(entries, "default_agent");
  const model =
    resolveAgentModel(entries, defaultAgent) ??
    latestConfigValue(entries, "model");
  const defaultModel = parseModelConfig(model);
  const startMode = normalizeStartMode(defaultAgent);

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
