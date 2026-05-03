import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CellForm } from "@/components/cell-form";
import { linearIssueToCellPrefill } from "@/lib/linear-issue-cell-prefill";
import {
  ensureSelectedWorkspace,
  workspaceLoaderDeps,
} from "@/lib/workspace-selection";
import { linearQueries } from "@/queries/linear";
import { templateQueries } from "@/queries/templates";

const cellNewSearchSchema = z.object({
  workspaceId: z.string().optional(),
  linearIssueId: z.string().optional(),
});

export const Route = createFileRoute("/cells/new")({
  validateSearch: (search) => cellNewSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({
    ...workspaceLoaderDeps({ search }),
    linearIssueId: search.linearIssueId,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const workspace = await ensureSelectedWorkspace(
      queryClient,
      deps.workspaceId
    );
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
    ? linearIssueToCellPrefill(linearIssue)
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
