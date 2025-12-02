import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { Context, Effect, Layer } from "effect";
import {
  getWorkspaceRegistryEffect,
  type WorkspaceRegistry,
  WorkspaceRegistryLayer,
} from "../workspaces/registry";
import { loadConfig } from "./loader";
import type { HiveConfig } from "./schema";

const CONFIG_FILENAME = "hive.config.ts";
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
  return existsSync(join(directory, CONFIG_FILENAME));
}

export function getHiveConfig(workspaceRoot?: string): Promise<HiveConfig> {
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
  | HiveConfigWorkspaceError;

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
  readonly load: (
    workspaceRoot?: string
  ) => Effect.Effect<HiveConfig, HiveConfigError>;
  readonly clear: (workspaceRoot?: string) => Effect.Effect<void>;
};

export const HiveConfigService = Context.GenericTag<HiveConfigService>(
  "@hive/server/HiveConfigService"
);

export const HiveConfigLayer = Layer.effect(
  HiveConfigService,
  Effect.gen(function* () {
    const resolvedAtStartup = resolveWorkspaceRoot();

    const load = (workspaceRoot?: string) =>
      Effect.tryPromise({
        try: () => getHiveConfig(workspaceRoot ?? resolvedAtStartup),
        catch: (cause) =>
          makeHiveConfigError(workspaceRoot ?? resolvedAtStartup, cause),
      });

    const clear = (workspaceRoot?: string) =>
      Effect.sync(() => {
        clearHiveConfigCache(workspaceRoot ?? resolvedAtStartup);
      });

    return {
      workspaceRoot: resolvedAtStartup,
      resolve: () => resolveWorkspaceRoot(),
      load,
      clear,
    } satisfies HiveConfigService;
  })
);

const selectWorkspaceForConfig = (
  registry: WorkspaceRegistry,
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

export const loadHiveConfigEffect = (workspaceRoot?: string) =>
  Effect.flatMap(HiveConfigService, (service) => service.load(workspaceRoot));

export const loadWorkspaceHiveConfigEffect = (workspaceId?: string) =>
  Effect.gen(function* () {
    const registry = yield* getWorkspaceRegistryEffect;
    const workspace = selectWorkspaceForConfig(registry, workspaceId);

    if (!workspace) {
      return yield* Effect.fail(makeHiveConfigWorkspaceError(workspaceId));
    }

    return yield* loadHiveConfigEffect(workspace.path);
  });

export const loadHiveConfig = (workspaceRoot?: string): Promise<HiveConfig> =>
  Effect.runPromise(
    Effect.provide(HiveConfigLayer)(loadHiveConfigEffect(workspaceRoot))
  );

export const loadWorkspaceHiveConfig = (
  workspaceId?: string
): Promise<HiveConfig> =>
  Effect.runPromise(
    Effect.provide(Layer.mergeAll(HiveConfigLayer, WorkspaceRegistryLayer))(
      loadWorkspaceHiveConfigEffect(workspaceId)
    )
  );
