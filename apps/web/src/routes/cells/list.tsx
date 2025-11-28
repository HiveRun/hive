import { createFileRoute } from "@tanstack/react-router";
import { CellList } from "@/components/cell-list";
import { ensureActiveWorkspace } from "@/lib/workspace";
import { cellQueries } from "@/queries/cells";

export const Route = createFileRoute("/cells/list")({
  loader: async ({ context: { queryClient } }) => {
    const workspace = await ensureActiveWorkspace(queryClient);
    await queryClient.ensureQueryData(cellQueries.all(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useLoaderData();
  return <CellList workspaceId={workspaceId} />;
}
