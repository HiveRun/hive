import { createFileRoute } from "@tanstack/react-router";
import { ConstructForm } from "@/components/construct-form";
import { ensureActiveWorkspace } from "@/lib/workspace";
import { templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/constructs/new")({
  loader: async ({ context: { queryClient } }) => {
    const workspace = await ensureActiveWorkspace(queryClient);
    await queryClient.ensureQueryData(templateQueries.all(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useLoaderData();
  return (
    <div className="p-6">
      <ConstructForm
        onSuccess={() => window.history.back()}
        workspaceId={workspaceId}
      />
    </div>
  );
}
