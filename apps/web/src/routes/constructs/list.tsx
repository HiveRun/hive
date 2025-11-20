import { createFileRoute } from "@tanstack/react-router";
import { ConstructList } from "@/components/construct-list";
import { ensureActiveWorkspace } from "@/lib/workspace";
import { constructQueries } from "@/queries/constructs";

export const Route = createFileRoute("/constructs/list")({
  loader: async ({ context: { queryClient } }) => {
    const workspace = await ensureActiveWorkspace(queryClient);
    await queryClient.ensureQueryData(constructQueries.all(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useLoaderData();
  return <ConstructList workspaceId={workspaceId} />;
}
