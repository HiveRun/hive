import { resolve as resolvePath } from "node:path";
import type { WorkspaceRegistryError } from "../workspaces/registry";
import { getWorkspaceRegistry } from "../workspaces/registry";
import { hasConfigFile } from "./files";
import { loadConfig } from "./loader";
import type { HiveConfig } from "./schema";

const FALLBACK_DIRECTORY = "hive";
const configCache = new Map<string, Promise<HiveConfig>>();

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

function loadHiveConfigCached(workspaceRoot?: string): Promise<HiveConfig> {
  const normalizedRoot = resolvePath(workspaceRoot ?? resolveWorkspaceRoot());
  if (!configCache.has(normalizedRoot)) {
    configCache.set(normalizedRoot, loadConfig(normalizedRoot));
  }
  return configCache.get(normalizedRoot) as Promise<HiveConfig>;
}

export function clearHiveConfigCache(workspaceRoot?: string): void {
  if (workspaceRoot) {
    configCache.delete(resolvePath(workspaceRoot));
    return;
  }
  configCache.clear();
}

export type HiveConfigError = {
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

export type HiveConfigWorkspaceError = {
  readonly _tag: "HiveConfigWorkspaceError";
  readonly workspaceId?: string;
  readonly message: string;
};

export type HiveConfigResolutionError =
  | HiveConfigError
  | HiveConfigWorkspaceError
  | WorkspaceRegistryError;

const makeHiveConfigWorkspaceError = (
  workspaceId?: string
): HiveConfigWorkspaceError => ({
  _tag: "HiveConfigWorkspaceError",
  workspaceId,
  message: workspaceId
    ? `Workspace '${workspaceId}' not found`
    : "No active workspace. Register and activate a workspace to continue.",
});

export type HiveConfigService = {
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

export const HiveConfigService = hiveConfigService;

const selectWorkspaceForConfig = (
  registry: Awaited<ReturnType<typeof getWorkspaceRegistry>>,
  workspaceId?: string
) => {
  if (workspaceId) {
    return registry.workspaces.find((entry) => entry.id === workspaceId);
  }
  if (registry.activeWorkspaceId) {
    return registry.workspaces.find(
      (entry) => entry.id === registry.activeWorkspaceId
    );
  }
  return null;
};

export const loadHiveConfig = (workspaceRoot?: string) =>
  hiveConfigService.load(workspaceRoot);

export const loadWorkspaceHiveConfig = async (workspaceId?: string) => {
  const registry = await getWorkspaceRegistry();
  const workspace = selectWorkspaceForConfig(registry, workspaceId);
  if (!workspace) {
    throw makeHiveConfigWorkspaceError(workspaceId);
  }
  return await loadHiveConfig(workspace.path);
};
