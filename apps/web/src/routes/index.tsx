import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type CellServiceSummary,
  type CellStatus,
  cellQueries,
} from "@/queries/cells";
import { type TemplatesResponse, templateQueries } from "@/queries/templates";
import { workspaceQueries } from "@/queries/workspaces";

type CellSummary = Awaited<
  ReturnType<ReturnType<typeof cellQueries.all>["queryFn"]>
>[number];

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) => {
    queryClient
      .fetchQuery(workspaceQueries.list())
      .then((workspaceData) => {
        for (const workspace of workspaceData.workspaces) {
          queryClient.prefetchQuery(cellQueries.all(workspace.id));
          queryClient.prefetchQuery(templateQueries.all(workspace.id));
        }
      })
      .catch(() => {
        // non-blocking prefetch; overview component handles fetch errors
      });

    return null;
  },
  component: HiveOverview,
});

function HiveOverview() {
  const routerState = useRouterState({
    select: (state) => ({ pathname: state.location.pathname }),
  });
  const workspaceQuery = useQuery(workspaceQueries.list());
  const workspaces = workspaceQuery.data?.workspaces ?? [];

  const cellListQueries = useQueries({
    queries: workspaces.map((workspace) => {
      const config = cellQueries.all(workspace.id);
      return {
        queryKey: config.queryKey,
        queryFn: config.queryFn,
        staleTime: 10_000,
      };
    }),
  });

  const templatesQueries = useQueries({
    queries: workspaces.map((workspace) => {
      const config = templateQueries.all(workspace.id);
      return {
        queryKey: config.queryKey,
        queryFn: config.queryFn,
        staleTime: 30_000,
      };
    }),
  });

  const cellsByWorkspace = new Map<string, CellSummary[]>();
  workspaces.forEach((workspace, index) => {
    const query = cellListQueries[index];
    if (query?.data) {
      cellsByWorkspace.set(workspace.id, query.data);
    }
  });

  const templatesByWorkspace = new Map<string, TemplatesResponse>();
  workspaces.forEach((workspace, index) => {
    const query = templatesQueries[index];
    if (query?.data) {
      templatesByWorkspace.set(workspace.id, query.data);
    }
  });

  const allCells = workspaces.flatMap(
    (workspace) => cellsByWorkspace.get(workspace.id) ?? []
  );

  const serviceQueries = useQueries({
    queries: allCells.map((cell) => {
      const config = cellQueries.services(cell.id);
      return {
        queryKey: config.queryKey,
        queryFn: config.queryFn,
        enabled: cell.status === "ready",
        staleTime: 15_000,
      };
    }),
  });

  const servicesByCellId = new Map<
    string,
    { services?: CellServiceSummary[]; isLoading: boolean; isError: boolean }
  >();
  allCells.forEach((cell, index) => {
    const query = serviceQueries[index];
    if (!query) {
      return;
    }
    servicesByCellId.set(cell.id, {
      services: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
    });
  });

  if (workspaceQuery.isLoading) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading workspaces…
      </div>
    );
  }

  if (workspaceQuery.error) {
    const message =
      workspaceQuery.error instanceof Error
        ? workspaceQuery.error.message
        : "Failed to load workspaces";
    return <div className="p-6 text-destructive">{message}</div>;
  }

  if (workspaces.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>No workspaces registered</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            Add a workspace from the sidebar to get started.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl text-foreground tracking-wide">
          Hive Overview
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Birdseye view of cells, templates, and services across workspaces.
        </p>
      </div>

      <div className="grid gap-6">
        {workspaces.map((workspace) => {
          const cells = cellsByWorkspace.get(workspace.id) ?? [];
          const templates = templatesByWorkspace.get(workspace.id)?.templates;
          const templateLabel = (templateId?: string) =>
            templates?.find((t) => t.id === templateId)?.label ?? templateId;

          return (
            <Card className="border-2 border-border bg-card" key={workspace.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.22em]">
                      Workspace
                    </div>
                    <CardTitle className="truncate text-base uppercase tracking-[0.18em]">
                      {workspace.label}
                    </CardTitle>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {workspace.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{cells.length} cells</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {cells.length === 0 ? (
                  <div className="rounded-sm border border-border/60 bg-muted/10 p-4 text-muted-foreground text-sm">
                    No cells in this workspace.
                  </div>
                ) : (
                  <div className="divide-y divide-border/60 rounded-sm border border-border/60">
                    {cells.map((cell) => {
                      const isActive = routerState.pathname.startsWith(
                        `/cells/${cell.id}`
                      );
                      const serviceState = servicesByCellId.get(cell.id);
                      return (
                        <div
                          className={cn(
                            "grid grid-cols-1 gap-3 p-4 md:grid-cols-[minmax(220px,1.2fr)_minmax(140px,0.6fr)_minmax(220px,1fr)]",
                            isActive &&
                              "bg-primary/5 shadow-[inset_3px_0_0_0_hsl(var(--primary))]"
                          )}
                          key={cell.id}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <Link
                                className="min-w-0 truncate font-semibold text-foreground"
                                params={{ cellId: cell.id }}
                                search={{ workspaceId: cell.workspaceId }}
                                to="/cells/$cellId/chat"
                              >
                                {cell.name}
                              </Link>
                              <StatusBadge status={cell.status} />
                            </div>
                            {cell.description ? (
                              <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
                                {cell.description}
                              </p>
                            ) : (
                              <p className="mt-1 text-muted-foreground text-sm">
                                No description.
                              </p>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                              Template
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-foreground">
                              {templateLabel(cell.templateId) ?? "—"}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                              Services
                            </div>
                            <div className="mt-2">
                              <ServicesSummary
                                cellStatus={cell.status}
                                services={serviceState?.services}
                                servicesError={serviceState?.isError}
                                servicesLoading={serviceState?.isLoading}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CellStatus }) {
  const toneMap: Record<CellStatus, string> = {
    ready: "bg-primary/15 text-primary",
    pending: "bg-muted text-muted-foreground",
    spawning: "bg-secondary/20 text-secondary-foreground",
    error: "bg-destructive/10 text-destructive",
  };
  return (
    <span
      className={cn(
        "rounded-sm px-3 py-1 text-[10px] uppercase tracking-[0.35em]",
        toneMap[status]
      )}
    >
      {status}
    </span>
  );
}

function ServicesSummary({
  cellStatus,
  services,
  servicesLoading,
  servicesError,
}: {
  cellStatus: CellStatus;
  services?: CellServiceSummary[];
  servicesLoading?: boolean;
  servicesError?: boolean;
}) {
  if (cellStatus !== "ready") {
    return (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        Not available while {cellStatus}
      </p>
    );
  }

  if (servicesLoading) {
    return (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        Loading services…
      </p>
    );
  }

  if (servicesError) {
    return (
      <p className="text-[11px] text-destructive uppercase tracking-[0.3em]">
        Service status unavailable
      </p>
    );
  }

  if (!services || services.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        No services configured
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {services.map((service) => (
        <div
          className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/10 px-2 py-1"
          key={service.id}
        >
          <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
            {service.name}
          </span>
          <div className="flex items-center gap-2">
            {service.port ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                :{service.port}
              </span>
            ) : null}
            <ServiceStatusPill status={service.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ServiceStatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const toneMap: Record<string, string> = {
    running: "bg-primary/15 text-primary",
    starting: "bg-secondary/20 text-secondary-foreground",
    pending: "bg-muted text-muted-foreground",
    needs_resume: "bg-secondary/20 text-secondary-foreground",
    error: "bg-destructive/10 text-destructive",
    stopped: "bg-border/20 text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-[0.3em]",
        toneMap[normalized] ?? "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  );
}
