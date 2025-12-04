import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cellQueries } from "@/queries/cells";
import { templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/cells/$cellId")({
  beforeLoad: ({ params, location }) => {
    if (location.pathname === `/cells/${params.cellId}`) {
      throw redirect({
        to: "/cells/$cellId/chat",
        params,
      });
    }
  },
  loader: async ({ params, context: { queryClient } }) => {
    const cell = await queryClient.ensureQueryData(
      cellQueries.detail(params.cellId)
    );
    await queryClient.ensureQueryData(templateQueries.all(cell.workspaceId));
    return { workspaceId: cell.workspaceId };
  },
  component: CellLayout,
});

function CellLayout() {
  const { cellId } = Route.useParams();
  const { workspaceId } = Route.useLoaderData();
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const templatesQuery = useQuery(templateQueries.all(workspaceId));
  const activeRouteId = useRouterState({
    select: (state) => state.matches.at(-1)?.routeId,
  });

  const cell = cellQuery.data;
  const templates = templatesQuery.data?.templates ?? [];

  const templateLabel = templates.find(
    (template) => template.id === cell?.templateId
  )?.label;
  const navItems = [
    {
      routeId: "/cells/$cellId/services",
      label: "Services",
      to: "/cells/$cellId/services",
    },
    {
      routeId: "/cells/$cellId/diff",
      label: "Diff",
      to: "/cells/$cellId/diff",
    },
    {
      routeId: "/cells/$cellId/chat",
      label: "Chat",
      to: "/cells/$cellId/chat",
    },
  ];

  if (!cell) {
    return (
      <div className="flex h-full w-full flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 items-center justify-center border-2 border-border bg-card p-6 text-muted-foreground text-sm">
          Unable to load cell. It may have been deleted.
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
                {cell.name}
              </h1>
              <span className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
                {cell.id}
              </span>
            </div>
            {cell.description ? (
              <p className="max-w-3xl text-muted-foreground text-sm">
                {cell.description}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
              <span>Template · {templateLabel ?? cell.templateId}</span>
              <span>Workspace · {cell.workspacePath}</span>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          {navItems.map((item) => (
            <Link key={item.routeId} params={{ cellId }} to={item.to}>
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
