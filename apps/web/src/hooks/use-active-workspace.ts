import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { workspaceQueries } from "@/queries/workspaces";

export function useActiveWorkspace() {
  const workspaceQuery = useQuery(workspaceQueries.list());
  const activeWorkspace = useMemo(() => {
    const data = workspaceQuery.data;
    if (!data?.activeWorkspaceId) {
      return;
    }
    return data.workspaces.find(
      (workspace) => workspace.id === data.activeWorkspaceId
    );
  }, [workspaceQuery.data]);

  return {
    ...workspaceQuery,
    activeWorkspace,
  };
}
