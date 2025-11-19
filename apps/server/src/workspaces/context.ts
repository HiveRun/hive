import { getSyntheticConfig } from "../config/context";
import type { SyntheticConfig } from "../config/schema";
import { createWorktreeManager } from "../worktree/manager";
import type { WorkspaceRecord } from "./registry";
import { getWorkspaceRegistry } from "./registry";

export type WorkspaceRuntimeContext = {
  workspace: WorkspaceRecord;
  loadConfig: () => Promise<SyntheticConfig>;
  createWorktreeManager: () => Promise<
    ReturnType<typeof createWorktreeManager>
  >;
};

export async function resolveWorkspaceContext(
  workspaceId?: string
): Promise<WorkspaceRuntimeContext> {
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
    throw new Error(
      workspaceId
        ? `Workspace '${workspaceId}' not found`
        : "No active workspace. Register and activate a workspace to continue."
    );
  }

  const resolvedWorkspace = workspace;
  let configPromise: Promise<SyntheticConfig> | null = null;

  const loadConfig = () => {
    if (!configPromise) {
      configPromise = getSyntheticConfig(resolvedWorkspace.path);
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
  };
}
