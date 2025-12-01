import { Effect } from "effect";
import { getHiveConfig } from "../config/context";
import type { HiveConfig } from "../config/schema";
import { runServerEffect } from "../runtime";
import { createWorktreeManager } from "../worktree/manager";
import type {
  WorkspaceRecord,
  WorkspaceRegistryError,
  WorkspaceRegistryService,
} from "./registry";
import { getWorkspaceRegistryEffect } from "./registry";

export type WorkspaceRuntimeContext = {
  workspace: WorkspaceRecord;
  loadConfig: () => Promise<HiveConfig>;
  createWorktreeManager: () => Promise<
    ReturnType<typeof createWorktreeManager>
  >;
};

export class WorkspaceContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceContextError";
  }
}

const mapRegistryError = (error: WorkspaceRegistryError) =>
  new WorkspaceContextError(error.message);

export const resolveWorkspaceContextEffect = (
  workspaceId?: string
): Effect.Effect<
  WorkspaceRuntimeContext,
  WorkspaceContextError,
  WorkspaceRegistryService
> =>
  Effect.gen(function* () {
    const registry = yield* getWorkspaceRegistryEffect.pipe(
      Effect.mapError(mapRegistryError)
    );

    let workspace: WorkspaceRecord | undefined;
    if (workspaceId) {
      workspace = registry.workspaces.find((entry) => entry.id === workspaceId);
    } else if (registry.activeWorkspaceId) {
      workspace = registry.workspaces.find(
        (entry) => entry.id === registry.activeWorkspaceId
      );
    }

    if (!workspace) {
      return yield* Effect.fail(
        new WorkspaceContextError(
          workspaceId
            ? `Workspace '${workspaceId}' not found`
            : "No active workspace. Register and activate a workspace to continue."
        )
      );
    }

    const resolvedWorkspace = workspace;
    let configPromise: Promise<HiveConfig> | null = null;

    const loadConfig = () => {
      if (!configPromise) {
        configPromise = getHiveConfig(resolvedWorkspace.path);
      }
      return configPromise;
    };

    const createManager = async () => {
      const config = await loadConfig();
      return createWorktreeManager(resolvedWorkspace.path, config);
    };

    return {
      workspace: resolvedWorkspace,
      loadConfig,
      createWorktreeManager: createManager,
    } satisfies WorkspaceRuntimeContext;
  });

export function resolveWorkspaceContext(
  workspaceId?: string
): Promise<WorkspaceRuntimeContext> {
  return runServerEffect(resolveWorkspaceContextEffect(workspaceId));
}
