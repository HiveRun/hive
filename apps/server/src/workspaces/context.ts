import { Effect } from "effect";
import { HiveConfigService } from "../config/context";
import type { HiveConfig } from "../config/schema";
import {
  type WorktreeCreateOptions,
  type WorktreeLocation,
  type WorktreeManager,
  type WorktreeManagerService,
  WorktreeManagerServiceTag,
} from "../worktree/manager";
import type {
  WorkspaceRecord,
  WorkspaceRegistryError,
  WorkspaceRegistryService,
} from "./registry";
import { getWorkspaceRegistryEffect } from "./registry";

export type WorkspaceRuntimeContext = {
  workspace: WorkspaceRecord;
  loadConfig: () => Promise<HiveConfig>;
  createWorktreeManager: () => Promise<WorktreeManager>;
  createWorktree: (
    cellId: string,
    options?: WorktreeCreateOptions
  ) => Promise<WorktreeLocation>;
  removeWorktree: (cellId: string) => Promise<void>;
};

export type ResolveWorkspaceContext = (
  workspaceId?: string
) => Promise<WorkspaceRuntimeContext>;

export class WorkspaceContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceContextError";
  }
}

const mapRegistryError = (error: WorkspaceRegistryError) =>
  new WorkspaceContextError(error.message);

const formatError = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export const resolveWorkspaceContextEffect = (
  workspaceId?: string
): Effect.Effect<
  WorkspaceRuntimeContext,
  WorkspaceContextError,
  WorkspaceRegistryService | HiveConfigService | WorktreeManagerService
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
    const hiveConfigService = yield* HiveConfigService;
    const worktreeService = yield* WorktreeManagerServiceTag;

    const toPromise = <A, E>(effect: Effect.Effect<A, E>, message: string) =>
      Effect.runPromise(
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceContextError(`${message}: ${formatError(cause)}`)
          )
        )
      );

    const loadConfig = () =>
      toPromise(
        hiveConfigService.load(resolvedWorkspace.path),
        "Failed to load workspace config"
      );

    const createManager = () =>
      toPromise(
        worktreeService.createManager(resolvedWorkspace.path),
        "Failed to initialize worktree manager"
      );

    const createWorktree = (cellId: string, options?: WorktreeCreateOptions) =>
      toPromise(
        worktreeService.createWorktree({
          workspacePath: resolvedWorkspace.path,
          cellId,
          ...(options ?? {}),
        }),
        "Failed to create git worktree"
      );

    const removeWorktree = (cellId: string) =>
      toPromise(
        worktreeService.removeWorktree(resolvedWorkspace.path, cellId),
        "Failed to remove git worktree"
      );

    return {
      workspace: resolvedWorkspace,
      loadConfig,
      createWorktreeManager: createManager,
      createWorktree,
      removeWorktree,
    } satisfies WorkspaceRuntimeContext;
  });
