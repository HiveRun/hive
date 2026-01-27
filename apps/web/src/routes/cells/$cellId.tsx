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
import { workspaceQueries } from "@/queries/workspaces";

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
    const workspaces = await queryClient.ensureQueryData(
      workspaceQueries.list()
    );
    const workspaceLabel =
      workspaces.workspaces.find((entry) => entry.id === cell.workspaceId)
        ?.label ?? undefined;
    await queryClient.ensureQueryData(templateQueries.all(cell.workspaceId));
    return { workspaceId: cell.workspaceId, workspaceLabel };
  },
  component: CellLayout,
});

function CellLayout() {
  const { cellId } = Route.useParams();
  const { workspaceLabel } = Route.useLoaderData();
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const routerState = useRouterState();
  const activeRouteId = routerState.matches.at(-1)?.routeId;

  const cell = cellQuery.data;
  const navItems = [
    {
      routeId: "/cells/$cellId/setup",
      label: "Info",
      to: "/cells/$cellId/setup",
    },
    {
      routeId: "/cells/$cellId/services",
      label: "Services",
      to: "/cells/$cellId/services",
    },
    {
      routeId: "/cells/$cellId/viewer",
      label: "Viewer",
      to: "/cells/$cellId/viewer",
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

  const titlePrefix = workspaceLabel?.trim();

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
        <section className="w-full shrink-0 border-2 border-border bg-card px-4 py-3 text-muted-foreground text-sm">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                {titlePrefix ? (
                  <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground uppercase tracking-[0.22em]">
                    <span>Workspace</span>
                    <span className="h-3 w-px bg-border/60" />
                    <span className="text-primary">{titlePrefix}</span>
                  </div>
                ) : null}
                <h1 className="font-semibold text-2xl text-foreground tracking-wide">
                  {cell.name}
                </h1>
              </div>
              <div className="flex flex-wrap gap-2">
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
            </div>
            {cell.description ? (
              <p className="max-w-3xl text-muted-foreground text-sm">
                {cell.description}
              </p>
            ) : null}
          </div>
        </section>

        <div className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
