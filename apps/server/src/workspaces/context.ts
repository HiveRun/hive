import { hiveConfigService } from "../config/context";
import type { HiveConfig } from "../config/schema";
import {
  createWorktreeManager,
  toAsyncWorktreeManager,
  type WorktreeCreateOptions,
  type WorktreeLocation,
  type WorktreeManager,
} from "../worktree/manager";
import type { WorkspaceRecord } from "./registry";
import { getWorkspaceRegistry } from "./registry";

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

const formatError = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export const resolveWorkspaceContext: ResolveWorkspaceContext = async (
  workspaceId?: string
) => {
  const registry = await getWorkspaceRegistry();

  let workspace: WorkspaceRecord | undefined;
  if (workspaceId) {
    workspace = registry.workspaces.find((entry) => entry.id === workspaceId);
  } else if (registry.activeWorkspaceId) {
    workspace = registry.workspaces.find(
      (entry) => entry.id === registry.activeWorkspaceId
    );
  }

  if (!workspace) {
    throw new WorkspaceContextError(
      workspaceId
        ? `Workspace '${workspaceId}' not found`
        : "No active workspace. Register and activate a workspace to continue."
    );
  }

  const resolvedWorkspace = workspace;

  const loadConfig: WorkspaceRuntimeContext["loadConfig"] = async () => {
    try {
      return await hiveConfigService.load(resolvedWorkspace.path);
    } catch (cause) {
      throw new WorkspaceContextError(
        `Failed to load workspace config: ${formatError(cause)}`
      );
    }
  };

  const createManager: WorkspaceRuntimeContext["createWorktreeManager"] =
    async () => {
      try {
        const hiveConfig = await loadConfig();
        return createWorktreeManager(resolvedWorkspace.path, hiveConfig);
      } catch (cause) {
        throw new WorkspaceContextError(
          `Failed to initialize worktree manager: ${formatError(cause)}`
        );
      }
    };

  const createWorktree: WorkspaceRuntimeContext["createWorktree"] = async (
    cellId,
    options
  ) => {
    try {
      const manager = toAsyncWorktreeManager(await createManager());
      return await manager.createWorktree(cellId, options);
    } catch (cause) {
      throw new WorkspaceContextError(
        `Failed to create git worktree: ${formatError(cause)}`
      );
    }
  };

  const removeWorktree: WorkspaceRuntimeContext["removeWorktree"] = async (
    cellId
  ) => {
    try {
      const manager = toAsyncWorktreeManager(await createManager());
      await manager.removeWorktree(cellId);
    } catch (cause) {
      throw new WorkspaceContextError(
        `Failed to remove git worktree: ${formatError(cause)}`
      );
    }
  };

  return {
    workspace: resolvedWorkspace,
    loadConfig,
    createWorktreeManager: createManager,
    createWorktree,
    removeWorktree,
  };
};
