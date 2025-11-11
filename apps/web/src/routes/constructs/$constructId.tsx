import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AgentChat } from "@/components/agent-chat";
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
  const templates = templatesQuery.data?.templates ?? [];

  const templateLabel = templates.find(
    (template) => template.id === construct?.templateId
  )?.label;

  if (!construct) {
    return (
      <div className="flex h-full w-full flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 items-center justify-center border-2 border-[#1f1f1c] bg-[#080908] p-6 text-[#b1b3ab] text-sm">
          Unable to load construct. It may have been deleted.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
        <section className="w-full shrink-0 border-2 border-[#1f1f1c] bg-[#080908] px-4 py-3 text-[#b1b3ab] text-sm">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-semibold text-2xl text-[#f8f8f3] tracking-wide">
                {construct.name}
              </h1>
              <span className="text-[#7b7e76] text-[11px] uppercase tracking-[0.3em]">
                {construct.id}
              </span>
            </div>
            {construct.description ? (
              <p className="max-w-3xl text-[#8e9088] text-sm">
                {construct.description}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-4 text-[#8e9088] text-[11px] uppercase tracking-[0.2em]">
              <span>Template · {templateLabel ?? construct.templateId}</span>
              <span>Workspace · {construct.workspacePath}</span>
            </div>
          </div>
        </section>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-[#1f1f1c] bg-[#050505]">
          <AgentChat constructId={constructId} />
        </div>
      </div>
    </div>
  );
}
