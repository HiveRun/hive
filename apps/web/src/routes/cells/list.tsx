import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CellList } from "@/components/cell-list";
import { cellQueries } from "@/queries/cells";
import { workspaceQueries } from "@/queries/workspaces";

const cellListSearchSchema = z.object({
  workspaceId: z.string().optional(),
});

export const Route = createFileRoute("/cells/list")({
  validateSearch: (search) => cellListSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({
    workspaceId: search.workspaceId,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const data = await queryClient.ensureQueryData(workspaceQueries.list());
    const requestedWorkspace = deps.workspaceId
      ? data.workspaces.find((entry) => entry.id === deps.workspaceId)
      : undefined;
    const activeWorkspace = data.activeWorkspaceId
      ? data.workspaces.find((entry) => entry.id === data.activeWorkspaceId)
      : undefined;
    const workspace =
      requestedWorkspace ?? activeWorkspace ?? data.workspaces[0];
    if (!workspace) {
      throw new Error("No workspaces registered. Add one to continue.");
    }
    await queryClient.ensureQueryData(cellQueries.all(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useLoaderData();
  return <CellList workspaceId={workspaceId} />;
}
