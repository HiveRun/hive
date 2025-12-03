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
  loadConfig: () => Effect.Effect<HiveConfig, WorkspaceContextError>;
  createWorktreeManager: () => Effect.Effect<
    WorktreeManager,
    WorkspaceContextError
  >;
  createWorktree: (
    cellId: string,
    options?: WorktreeCreateOptions
  ) => Effect.Effect<WorktreeLocation, WorkspaceContextError>;
  removeWorktree: (
    cellId: string
  ) => Effect.Effect<void, WorkspaceContextError>;
};

export type ResolveWorkspaceContext = (
  workspaceId?: string
) => Effect.Effect<
  WorkspaceRuntimeContext,
  WorkspaceContextError,
  WorkspaceRegistryService | HiveConfigService | WorktreeManagerService
>;

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

    const wrap =
      <A>(message: string) =>
      (
        effect: Effect.Effect<A, unknown>
      ): Effect.Effect<A, WorkspaceContextError> =>
        effect.pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceContextError(`${message}: ${formatError(cause)}`)
          )
        );

    const loadConfig: WorkspaceRuntimeContext["loadConfig"] = () =>
      wrap<HiveConfig>("Failed to load workspace config")(
        hiveConfigService.load(resolvedWorkspace.path)
      );

    const createManager: WorkspaceRuntimeContext["createWorktreeManager"] =
      () =>
        wrap<WorktreeManager>("Failed to initialize worktree manager")(
          worktreeService.createManager(resolvedWorkspace.path)
        );

    const createWorktree: WorkspaceRuntimeContext["createWorktree"] = (
      cellId,
      options
    ) =>
      wrap<WorktreeLocation>("Failed to create git worktree")(
        worktreeService.createWorktree({
          workspacePath: resolvedWorkspace.path,
          cellId,
          ...(options ?? {}),
        })
      );

    const removeWorktree: WorkspaceRuntimeContext["removeWorktree"] = (
      cellId
    ) =>
      wrap<void>("Failed to remove git worktree")(
        worktreeService.removeWorktree(resolvedWorkspace.path, cellId)
      );

    return {
      workspace: resolvedWorkspace,
      loadConfig,
      createWorktreeManager: createManager,
      createWorktree,
      removeWorktree,
    } satisfies WorkspaceRuntimeContext;
  });
