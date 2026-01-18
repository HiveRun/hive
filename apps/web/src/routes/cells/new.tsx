import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CellForm } from "@/components/cell-form";
import { templateQueries } from "@/queries/templates";
import { workspaceQueries } from "@/queries/workspaces";

const cellNewSearchSchema = z.object({
  workspaceId: z.string().optional(),
});

export const Route = createFileRoute("/cells/new")({
  validateSearch: (search) => cellNewSearchSchema.parse(search),
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
    await queryClient.ensureQueryData(templateQueries.all(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useLoaderData();
  return (
    <div className="p-6">
      <CellForm
        onSuccess={() => window.history.back()}
        workspaceId={workspaceId}
      />
    </div>
  );
}
