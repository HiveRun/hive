import { stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { hasConfigFile } from "./files";
import { loadConfig } from "./loader";
import type { HiveConfig } from "./schema";

const FALLBACK_DIRECTORY = "hive";
type ConfigCacheEntry = {
  mtimeMs: number | null;
  promise: Promise<HiveConfig>;
};

const configCache = new Map<string, ConfigCacheEntry>();
const CONFIG_FILENAME = "hive.config.json";

export function resolveWorkspaceRoot(): string {
  const baseRoot = resolveBaseWorkspaceRoot();
  return findConfigRoot(baseRoot);
}

function resolveBaseWorkspaceRoot(): string {
  const forcedWorkspaceRoot = process.env.HIVE_WORKSPACE_ROOT;
  if (forcedWorkspaceRoot) {
    return resolvePath(forcedWorkspaceRoot);
  }

  const currentDir = process.cwd();
  if (currentDir.includes("/apps/")) {
    const [root] = currentDir.split("/apps/");
    return root || currentDir;
  }
  return currentDir;
}

function findConfigRoot(baseRoot: string): string {
  const normalizedRoot = resolvePath(baseRoot);
  if (hasConfig(normalizedRoot)) {
    return normalizedRoot;
  }

  const nestedCandidate = resolvePath(normalizedRoot, FALLBACK_DIRECTORY);
  if (hasConfig(nestedCandidate)) {
    return nestedCandidate;
  }

  return normalizedRoot;
}

function hasConfig(directory: string): boolean {
  return hasConfigFile(directory);
}

async function readConfigMtimeMs(
  workspaceRoot: string
): Promise<number | null> {
  try {
    const configPath = resolvePath(workspaceRoot, CONFIG_FILENAME);
    const stats = await stat(configPath);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

async function loadHiveConfigCached(
  workspaceRoot?: string
): Promise<HiveConfig> {
  const normalizedRoot = resolvePath(workspaceRoot ?? resolveWorkspaceRoot());
  const mtimeMs = await readConfigMtimeMs(normalizedRoot);
  const cachedEntry = configCache.get(normalizedRoot);

  if (!(cachedEntry && cachedEntry.mtimeMs === mtimeMs)) {
    const nextEntry: ConfigCacheEntry = {
      mtimeMs,
      promise: loadConfig(normalizedRoot),
    };
    configCache.set(normalizedRoot, nextEntry);
    return nextEntry.promise;
  }

  return cachedEntry.promise;
}

export function clearHiveConfigCache(workspaceRoot?: string): void {
  if (workspaceRoot) {
    configCache.delete(resolvePath(workspaceRoot));
    return;
  }
  configCache.clear();
}

type HiveConfigError = {
  readonly _tag: "HiveConfigError";
  readonly workspaceRoot: string;
  readonly cause: unknown;
};

const makeHiveConfigError = (
  workspaceRoot: string,
  cause: unknown
): HiveConfigError => ({
  _tag: "HiveConfigError",
  workspaceRoot,
  cause,
});

type HiveConfigService = {
  readonly workspaceRoot: string;
  readonly resolve: () => string;
  readonly load: (workspaceRoot?: string) => Promise<HiveConfig>;
  readonly clear: (workspaceRoot?: string) => void;
};

const resolvedAtStartup = resolveWorkspaceRoot();

export const hiveConfigService: HiveConfigService = {
  workspaceRoot: resolvedAtStartup,
  resolve: () => resolveWorkspaceRoot(),
  load: async (workspaceRoot?: string) => {
    const resolvedRoot = workspaceRoot ?? resolvedAtStartup;
    try {
      return await loadHiveConfigCached(resolvedRoot);
    } catch (cause) {
      throw makeHiveConfigError(resolvedRoot, cause);
    }
  },
  clear: (workspaceRoot?: string) => {
    clearHiveConfigCache(workspaceRoot ?? resolvedAtStartup);
  },
};

export const loadHiveConfig = (workspaceRoot?: string) =>
  hiveConfigService.load(workspaceRoot);
