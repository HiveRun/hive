import { workspaceQueries } from "@/queries/workspaces";

type WorkspaceEntry = {
  id: string;
};

type WorkspaceList<TWorkspace extends WorkspaceEntry> = {
  activeWorkspaceId?: string | null;
  workspaces: TWorkspace[];
};

type WorkspaceQueryClient = {
  ensureQueryData: <TData>(query: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<TData>;
  }) => Promise<TData>;
};

function selectWorkspace<TWorkspace extends WorkspaceEntry>(
  data: WorkspaceList<TWorkspace>,
  requestedWorkspaceId?: string
): TWorkspace {
  const requestedWorkspace = requestedWorkspaceId
    ? data.workspaces.find((entry) => entry.id === requestedWorkspaceId)
    : undefined;
  const activeWorkspace = data.activeWorkspaceId
    ? data.workspaces.find((entry) => entry.id === data.activeWorkspaceId)
    : undefined;
  const workspace = requestedWorkspace ?? activeWorkspace ?? data.workspaces[0];

  if (!workspace) {
    throw new Error("No workspaces registered. Add one to continue.");
  }

  return workspace;
}

export function workspaceLoaderDeps({
  search,
}: {
  search: { workspaceId?: string };
}) {
  return { workspaceId: search.workspaceId };
}

export async function ensureSelectedWorkspace(
  queryClient: WorkspaceQueryClient,
  requestedWorkspaceId?: string
) {
  const data = await queryClient.ensureQueryData(workspaceQueries.list());
  return selectWorkspace(data, requestedWorkspaceId);
}
