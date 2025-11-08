// biome-ignore lint/style/useFilenamingConvention: TanStack dynamic params require camelCase filenames.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AgentChat } from "@/components/agent-chat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { constructQueries } from "@/queries/constructs";
import { templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/constructs/$constructId")({
  loader: ({ params, context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(constructQueries.detail(params.constructId)),
      queryClient.ensureQueryData(templateQueries.all()),
    ]),
  component: ConstructDetail,
});

function ConstructDetail() {
  const { constructId } = Route.useParams();
  const constructQuery = useQuery(constructQueries.detail(constructId));
  const templatesQuery = useQuery(templateQueries.all());

  const construct = constructQuery.data;
  const templates = templatesQuery.data;

  const templateLabel = templates?.find(
    (template) => template.id === construct?.templateId
  )?.label;

  if (!construct) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="p-6">
            Unable to load construct. It may have been deleted.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{construct.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{construct.description}</p>
          <p>
            <span className="font-semibold">Template:</span>{" "}
            {templateLabel ?? construct.templateId}
          </p>
          <p>
            <span className="font-semibold">Workspace:</span>{" "}
            {construct.workspacePath}
          </p>
        </CardContent>
      </Card>

      <AgentChat constructId={constructId} />
    </div>
  );
}
