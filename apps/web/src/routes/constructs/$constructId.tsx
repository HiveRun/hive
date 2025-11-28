import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { constructQueries } from "@/queries/constructs";
import { templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/constructs/$constructId")({
  beforeLoad: ({ params, location }) => {
    if (location.pathname === `/constructs/${params.constructId}`) {
      throw redirect({
        to: "/constructs/$constructId/chat",
        params,
      });
    }
  },
  loader: async ({ params, context: { queryClient } }) => {
    const construct = await queryClient.ensureQueryData(
      constructQueries.detail(params.constructId)
    );
    await queryClient.ensureQueryData(
      templateQueries.all(construct.workspaceId)
    );
    return { workspaceId: construct.workspaceId };
  },
  component: ConstructLayout,
});

function ConstructLayout() {
  const { constructId } = Route.useParams();
  const { workspaceId } = Route.useLoaderData();
  const constructQuery = useQuery(constructQueries.detail(constructId));
  const templatesQuery = useQuery(templateQueries.all(workspaceId));
  const activeRouteId = useRouterState({
    select: (state) => state.matches.at(-1)?.routeId ?? undefined,
  });

  const construct = constructQuery.data;
  const templates = templatesQuery.data?.templates ?? [];

  const templateLabel = templates.find(
    (template) => template.id === construct?.templateId
  )?.label;
  const navItems = [
    {
      routeId: "/constructs/$constructId/services",
      label: "Services",
      to: "/constructs/$constructId/services",
    },
    {
      routeId: "/constructs/$constructId/diff",
      label: "Diff",
      to: "/constructs/$constructId/diff",
    },
    {
      routeId: "/constructs/$constructId/chat",
      label: "Chat",
      to: "/constructs/$constructId/chat",
    },
  ];

  if (!construct) {
    return (
      <div className="flex h-full w-full flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 items-center justify-center border-2 border-border bg-card p-6 text-muted-foreground text-sm">
          Unable to load construct. It may have been deleted.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
        <section className="w-full shrink-0 border-2 border-border bg-card px-4 py-3 text-muted-foreground text-sm">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-semibold text-2xl text-foreground tracking-wide">
                {construct.name}
              </h1>
              <span className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
                {construct.id}
              </span>
            </div>
            {construct.description ? (
              <p className="max-w-3xl text-muted-foreground text-sm">
                {construct.description}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
              <span>Template · {templateLabel ?? construct.templateId}</span>
              <span>Workspace · {construct.workspacePath}</span>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          {navItems.map((item) => (
            <Link key={item.routeId} params={{ constructId }} to={item.to}>
              <Button
                variant={
                  activeRouteId === item.routeId ? "secondary" : "outline"
                }
              >
                {item.label}
              </Button>
            </Link>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
