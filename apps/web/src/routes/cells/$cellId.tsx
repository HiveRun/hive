import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { ProvisioningChecklistPanel } from "@/components/provisioning-checklist-panel";
import { Button } from "@/components/ui/button";
import { buildProvisioningChecklist } from "@/lib/provisioning-checklist";
import { cellQueries } from "@/queries/cells";
import { templateQueries } from "@/queries/templates";
import { workspaceQueries } from "@/queries/workspaces";

const PROVISIONING_POLL_MS = 1500;

export const Route = createFileRoute("/cells/$cellId")({
  beforeLoad: async ({ params, location, context: { queryClient } }) => {
    if (location.pathname === `/cells/${params.cellId}`) {
      const cell = await queryClient.ensureQueryData(
        cellQueries.detail(params.cellId)
      );

      throw redirect({
        to:
          cell.status === "ready"
            ? "/cells/$cellId/chat"
            : "/cells/$cellId/provisioning",
        params,
        replace: true,
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

    queryClient
      .prefetchQuery(templateQueries.all(cell.workspaceId))
      .catch(() => {
        // non-blocking prefetch; template routes/components handle fetch errors
      });

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
  const isProvisioningRoute = activeRouteId === "/cells/$cellId/provisioning";

  const cell = cellQuery.data;
  const shouldPollProvisioningTimings =
    cell?.status === "spawning" || cell?.status === "pending";
  const shouldShowProvisioningTimeline =
    shouldPollProvisioningTimings || cell?.status === "error";
  const timingsQuery = useQuery({
    ...cellQueries.timings(cellId, {
      workflow: "create",
      limit: 300,
    }),
    enabled: shouldShowProvisioningTimeline,
    refetchInterval: shouldPollProvisioningTimings
      ? PROVISIONING_POLL_MS
      : false,
  });
  const activeRunId = timingsQuery.data?.runs[0]?.runId;
  const activeRunSteps = useMemo(() => {
    if (!activeRunId) {
      return [];
    }

    return (timingsQuery.data?.steps ?? []).filter(
      (step) => step.runId === activeRunId
    );
  }, [activeRunId, timingsQuery.data?.steps]);
  const provisioningChecklist = useMemo(
    () =>
      buildProvisioningChecklist({
        cellStatus: cell?.status,
        steps: activeRunSteps,
      }),
    [cell?.status, activeRunSteps]
  );
  const navItems = [
    ...(cell?.status !== "ready"
      ? [
          {
            routeId: "/cells/$cellId/provisioning",
            label: "Provisioning",
            to: "/cells/$cellId/provisioning",
          } as const,
        ]
      : []),
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
      routeId: "/cells/$cellId/terminal",
      label: "Terminal",
      to: "/cells/$cellId/terminal",
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
  let statusMessage = "Ready";
  if (cell.status === "spawning") {
    statusMessage = "Provisioning workspace and services";
  } else if (cell.status === "pending") {
    statusMessage = "Preparing agent session";
  } else if (cell.status === "error") {
    statusMessage =
      "Provisioning failed. Open Info to inspect setup logs and retry.";
  }

  let statusTone = "text-amber-200 border-amber-500/40 bg-amber-500/10";
  if (cell.status === "ready") {
    statusTone = "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
  } else if (cell.status === "error") {
    statusTone = "text-red-300 border-red-500/40 bg-red-500/10";
  }

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
            <div
              className={`inline-flex w-fit items-center gap-2 border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${statusTone}`}
            >
              <span className="h-1.5 w-1.5 animate-pulse bg-current" />
              <span>{statusMessage}</span>
            </div>
            {shouldShowProvisioningTimeline && !isProvisioningRoute ? (
              <ProvisioningChecklistPanel
                checklist={provisioningChecklist}
                statusMessage={statusMessage}
              />
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
