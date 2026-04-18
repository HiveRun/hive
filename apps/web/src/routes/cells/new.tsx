import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CellForm } from "@/components/cell-form";
import { linearQueries } from "@/queries/linear";
import { templateQueries } from "@/queries/templates";
import { workspaceQueries } from "@/queries/workspaces";

const cellNewSearchSchema = z.object({
  workspaceId: z.string().optional(),
  linearIssueId: z.string().optional(),
});

export const Route = createFileRoute("/cells/new")({
  validateSearch: (search) => cellNewSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({
    workspaceId: search.workspaceId,
    linearIssueId: search.linearIssueId,
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
    const linearIssue = deps.linearIssueId
      ? await queryClient.ensureQueryData(
          linearQueries.issue(workspace.id, deps.linearIssueId)
        )
      : null;
    return { workspaceId: workspace.id, linearIssue };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { linearIssue, workspaceId } = Route.useLoaderData();
  const initialPrefill = linearIssue
    ? {
        name: linearIssue.title,
        description: [linearIssue.title, linearIssue.description]
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0
          )
          .join("\n\n"),
        sourceLabel: linearIssue.identifier,
      }
    : undefined;

  return (
    <div className="p-6">
      <CellForm
        initialPrefill={initialPrefill}
        onSuccess={() => window.history.back()}
        workspaceId={workspaceId}
      />
    </div>
  );
}
