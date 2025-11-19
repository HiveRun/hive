import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceSummary } from "@/queries/workspaces";
import { workspaceQueries } from "@/queries/workspaces";

export async function ensureActiveWorkspace(
  queryClient: QueryClient
): Promise<WorkspaceSummary> {
  const data = await queryClient.ensureQueryData(workspaceQueries.list());
  if (!data.workspaces.length) {
    throw new Error("No workspaces registered. Add one to continue.");
  }

  const activeWorkspaceId = data.activeWorkspaceId;
  if (!activeWorkspaceId) {
    throw new Error("Activate a workspace to continue.");
  }

  const workspace = data.workspaces.find(
    (entry) => entry.id === activeWorkspaceId
  );
  if (!workspace) {
    throw new Error("Selected workspace no longer exists.");
  }

  return workspace;
}
