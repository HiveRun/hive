import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Clock,
  Cpu,
  Loader2,
  PauseCircle,
  PlayCircle,
  RadioTower,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatBytes,
  formatCpuPercent,
  serviceStatusTone,
} from "@/lib/resource-format";
import { cn } from "@/lib/utils";
import { type AgentSession, agentQueries } from "@/queries/agents";
import {
  type CellServiceSummary,
  type CellStatus,
  type CellSummary,
  cellQueries,
} from "@/queries/cells";
import { type TemplatesResponse, templateQueries } from "@/queries/templates";
import { type WorkspaceSummary, workspaceQueries } from "@/queries/workspaces";

type ServiceQueryState = {
  services?: CellServiceSummary[];
  isLoading: boolean;
  isError: boolean;
};

type AgentSessionQueryState = {
  session?: AgentSession | null;
  isLoading: boolean;
  isError: boolean;
};

type HomeCell = {
  agentSession?: AgentSession | null;
  agentSessionState?: AgentSessionQueryState;
  cell: CellSummary;
  servicesState?: ServiceQueryState;
  templateLabel?: string;
  workspace: WorkspaceSummary;
};

type ServiceStats = {
  error: number;
  peakCpuPercent: number;
  running: number;
  starting: number;
  stopped: number;
  total: number;
  totalRssBytes: number;
};

type RuntimeState = "error" | "idle" | "none" | "working";

type RuntimeSummary = Record<RuntimeState, number> & {
  total: number;
};

const MAX_CONSTELLATION_CELLS = 28;
const READY_CELL_STALE_TIME_MS = 15_000;
const MIN_SIGNAL_PERCENT = 6;
const FULL_PERCENT = 100;
const CELL_INITIAL_SPLIT_PATTERN = /[\s/_.:-]+/;
const RUNTIME_CLOCK_INTERVAL_MS = 60_000;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

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
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(
      () => setNow(Date.now()),
      RUNTIME_CLOCK_INTERVAL_MS
    );
    return () => window.clearInterval(interval);
  }, []);

  const cellListQueries = useQueries({
    queries: workspaces.map((workspace) => {
      const config = cellQueries.all(workspace.id);
      return {
        queryKey: config.queryKey,
        queryFn: config.queryFn,
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
    queries: allCells.map((cell) =>
      readyCellQuery(
        cell,
        cellQueries.services(cell.id, { includeResources: true })
      )
    ),
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

  const agentSessionQueries = useQueries({
    queries: allCells.map((cell) =>
      readyCellQuery(cell, agentQueries.sessionByCell(cell.id))
    ),
  });

  const agentSessionStateByCellId = new Map<string, AgentSessionQueryState>();
  allCells.forEach((cell, index) => {
    const query = agentSessionQueries[index];
    if (query) {
      agentSessionStateByCellId.set(cell.id, {
        session: query.data,
        isLoading: query.isLoading,
        isError: query.isError,
      });
    }
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

  const homeCells = buildHomeCells({
    agentSessionStateByCellId,
    cellsByWorkspace,
    servicesByCellId,
    templatesByWorkspace,
    workspaces,
  });
  const serviceStats = getServiceStats(homeCells);
  const runningCells = homeCells.filter(isRunningCell);
  const runtimeSummary = getRuntimeSummary(homeCells);
  const hasCells = homeCells.length > 0;
  const hasServiceTelemetry = serviceStats.total > 0;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background/45">
      <div className="flex min-h-full w-full flex-1 flex-col gap-5 p-4 sm:p-6 xl:p-8">
        <SwarmHero
          runtimeSummary={runtimeSummary}
          serviceStats={serviceStats}
        />

        {hasCells ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
            <CellConstellation homeCells={homeCells} />
            <RuntimeStatusPanel
              homeCells={homeCells}
              now={now}
              runtimeSummary={runtimeSummary}
            />
          </div>
        ) : (
          <NoCellsDashboardState />
        )}

        {hasServiceTelemetry ? (
          <ServiceSignalStrip serviceStats={serviceStats} />
        ) : null}

        {hasCells ? (
          <RunningCellsPanel
            pathname={routerState.pathname}
            runningCells={runningCells}
          />
        ) : null}
      </div>
    </main>
  );
}

function NoCellsDashboardState() {
  return (
    <Card className="flex flex-1 flex-col border-2 border-border bg-card shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
      <CardHeader className="border-border border-b-2 pb-4">
        <div className="text-[10px] text-primary uppercase tracking-[0.38em]">
          No runtime data
        </div>
        <CardTitle className="text-xl uppercase tracking-[0.16em]">
          Create a cell to populate this deck
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 p-5">
        <div className="flex flex-1 items-center border-2 border-border border-dashed bg-background/60 p-5 text-muted-foreground text-sm leading-6">
          The home page only shows operational panels when there is something to
          inspect: cells, agent runtime state, or service telemetry. Use the
          workspace controls in the sidebar to start the first cell.
        </div>
      </CardContent>
    </Card>
  );
}

function readyCellQuery<TData>(
  cell: CellSummary,
  config: { queryFn: () => Promise<TData>; queryKey: readonly unknown[] }
) {
  return {
    enabled: cell.status === "ready",
    queryFn: config.queryFn,
    queryKey: config.queryKey,
    refetchInterval: READY_CELL_STALE_TIME_MS,
    staleTime: READY_CELL_STALE_TIME_MS,
  };
}

function SwarmHero({
  runtimeSummary,
  serviceStats,
}: {
  runtimeSummary: RuntimeSummary;
  serviceStats: ServiceStats;
}) {
  const runtimeSegments = getRuntimeSegments(runtimeSummary);
  const heroMetrics = [
    runtimeSummary.working > 0
      ? {
          icon: <PlayCircle className="size-4" />,
          label: "Working sessions",
          value: runtimeSummary.working.toString(),
        }
      : null,
    runtimeSummary.idle > 0
      ? {
          icon: <PauseCircle className="size-4" />,
          label: "Idle / waiting",
          value: runtimeSummary.idle.toString(),
        }
      : null,
    runtimeSummary.error > 0
      ? {
          icon: <Activity className="size-4" />,
          label: "Runtime errors",
          value: runtimeSummary.error.toString(),
        }
      : null,
    serviceStats.error > 0
      ? {
          icon: <Activity className="size-4" />,
          label: "Service errors",
          value: serviceStats.error.toString(),
        }
      : null,
    serviceStats.peakCpuPercent > 0
      ? {
          icon: <Cpu className="size-4" />,
          label: "Peak CPU",
          value: formatCpuPercent(serviceStats.peakCpuPercent),
        }
      : null,
  ].filter((metric) => metric !== null);

  return (
    <section className="relative overflow-hidden border-2 border-border bg-card shadow-[6px_6px_0_rgba(0,0,0,0.38)]">
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(135deg,_hsl(var(--primary)/0.17),_transparent_32%),_repeating-linear-gradient(90deg,_transparent_0_18px,_hsl(var(--border)/0.38)_18px_20px)]"
      />
      <div
        aria-hidden
        className="absolute top-[-92px] right-[-96px] size-72 rotate-12 border-[22px] border-primary/20 [clip-path:polygon(25%_6%,75%_6%,100%_50%,75%_94%,25%_94%,0_50%)]"
      />
      <div className="relative grid gap-6 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:p-7">
        <div className="flex min-w-0 flex-col justify-between gap-8">
          <div>
            <div className="mb-3 flex items-center gap-3 text-primary text-xs uppercase tracking-[0.42em]">
              <RadioTower className="size-4" />
              Live swarm telemetry
            </div>
            <h1 className="max-w-4xl font-semibold text-3xl text-foreground uppercase leading-none tracking-[0.12em] sm:text-5xl lg:text-6xl">
              Hive Command Deck
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground text-sm leading-6 sm:text-base">
              Current runtime state across cells, agent sessions, services, and
              resource pressure. Built for deciding what needs attention now.
            </p>
          </div>

          {heroMetrics.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {heroMetrics.map((metric) => (
                <MetricSlab
                  icon={metric.icon}
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative min-h-[260px] border-2 border-border bg-background/70 p-4 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-[0.36em]">
              Current session states
            </span>
            <span className="font-mono text-[11px] text-primary uppercase tracking-[0.24em]">
              {runtimeSummary.total} tracked
            </span>
          </div>
          {runtimeSummary.total === 0 ? (
            <div className="mt-6 border-2 border-border border-dashed bg-card/50 p-5 text-muted-foreground text-sm leading-6">
              No cells are tracked yet. Runtime state appears here after a cell
              exists and Hive can observe its agent session.
            </div>
          ) : (
            <div className="mt-6 space-y-5">
              <StackedStateBar
                segments={runtimeSegments}
                total={runtimeSummary.total}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {runtimeSegments
                  .filter((segment) => segment.count > 0)
                  .map((segment) => (
                    <div
                      className="border-2 border-border bg-card/70 p-3"
                      key={segment.label}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-[0.26em]">
                          {segment.label}
                        </span>
                        <span className="font-mono font-semibold text-foreground text-xl">
                          {segment.count}
                        </span>
                      </div>
                      <div className={cn("mt-3 h-1.5", segment.className)} />
                    </div>
                  ))}
              </div>
              <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
                Idle means awaiting input, completed, or ready with no active
                agent. Working means the agent session is starting or working.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StackedStateBar({
  segments,
  total,
}: {
  segments: ReturnType<typeof getRuntimeSegments>;
  total: number;
}) {
  if (total === 0) {
    return <div className="h-8 border-2 border-border bg-muted/20" />;
  }
  return (
    <div className="flex h-8 overflow-hidden border-2 border-border bg-background">
      {segments.map((segment) =>
        segment.count > 0 ? (
          <div
            className={cn("h-full", segment.className)}
            key={segment.label}
            style={{ width: `${getSegmentPercent(segment.count, total)}%` }}
            title={`${segment.label}: ${segment.count}`}
          />
        ) : null
      )}
    </div>
  );
}

function RuntimeStatusPanel({
  homeCells,
  now,
  runtimeSummary,
}: {
  homeCells: HomeCell[];
  now: number | null;
  runtimeSummary: RuntimeSummary;
}) {
  const runtimeRows = homeCells.map(getRuntimeRow);
  const segments = getRuntimeSegments(runtimeSummary);

  return (
    <Card className="border-2 border-border bg-card shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
      <CardHeader className="border-border border-b-2 pb-4">
        <div className="text-[10px] text-primary uppercase tracking-[0.38em]">
          Runtime status
        </div>
        <CardTitle className="text-xl uppercase tracking-[0.16em]">
          Idle vs working
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <StackedStateBar segments={segments} total={runtimeSummary.total} />
        <div className="grid grid-cols-2 gap-3">
          {segments
            .filter((segment) => segment.count > 0)
            .map((segment) => (
              <SignalStat
                key={segment.label}
                label={segment.label}
                value={segment.count.toString()}
              />
            ))}
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            <Clock className="size-3" />
            Current state age
          </div>
          {runtimeRows.length === 0 ? (
            <EmptyTelemetry message="No sessions or cells to measure yet." />
          ) : (
            <div className="divide-y divide-border/70 border-2 border-border">
              {runtimeRows.map((row) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 bg-background/60 p-3"
                  key={row.cell.id}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground text-sm">
                      {row.cell.name}
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
                      {row.reason}
                    </div>
                  </div>
                  <div className="text-right">
                    <RuntimeStateBadge state={row.state} />
                    <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {formatRuntimeAge(row.since, now)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RuntimeStateBadge({ state }: { state: RuntimeState }) {
  return (
    <span
      className={cn(
        "border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em]",
        getRuntimeStateTone(state)
      )}
    >
      {state === "none" ? "no agent" : state}
    </span>
  );
}

function getRuntimeStateTone(state: RuntimeState) {
  const toneMap: Record<RuntimeState, string> = {
    error: "border-destructive/70 bg-destructive/15 text-destructive",
    idle: "border-[#7C5BFF]/70 bg-[#7C5BFF]/10 text-foreground",
    none: "border-border bg-muted/20 text-muted-foreground",
    working: "border-primary/70 bg-primary/15 text-primary",
  };
  return toneMap[state];
}

function getRuntimeSegments(summary: RuntimeSummary) {
  return [
    {
      className: "bg-primary",
      count: summary.working,
      label: "Working",
    },
    {
      className: "bg-[#7C5BFF]",
      count: summary.idle,
      label: "Idle / waiting",
    },
    {
      className: "bg-destructive",
      count: summary.error,
      label: "Error",
    },
    {
      className: "bg-muted-foreground",
      count: summary.none,
      label: "No agent",
    },
  ];
}

function getRuntimeRow(homeCell: HomeCell) {
  const state = getRuntimeState(homeCell);
  const session = homeCell.agentSession;
  return {
    cell: homeCell.cell,
    reason: getRuntimeReason(homeCell, state),
    since: session?.updatedAt ?? session?.createdAt ?? homeCell.cell.createdAt,
    state,
  };
}

function getRuntimeReason(homeCell: HomeCell, state: RuntimeState) {
  const session = homeCell.agentSession;
  if (homeCell.agentSessionState?.isError) {
    return "agent session unavailable";
  }
  if (homeCell.agentSessionState?.isLoading) {
    return "loading agent session";
  }
  if (!session) {
    return homeCell.cell.status === "ready"
      ? "ready, no agent session"
      : homeCell.cell.status;
  }
  if (state === "working") {
    return `${session.status}${session.currentMode ? ` / ${session.currentMode}` : ""}`;
  }
  if (state === "idle") {
    return session.status === "awaiting_input"
      ? "awaiting input"
      : session.status;
  }
  return session.status;
}

function formatRuntimeAge(
  since: string | null | undefined,
  now: number | null
) {
  if (!(since && now)) {
    return "measuring";
  }
  const sinceMs = new Date(since).getTime();
  if (Number.isNaN(sinceMs) || sinceMs > now) {
    return "unknown";
  }
  return formatDuration(now - sinceMs);
}

function formatDuration(durationMs: number) {
  const totalMinutes = Math.max(
    0,
    Math.floor(durationMs / MILLISECONDS_PER_SECOND / SECONDS_PER_MINUTE)
  );
  if (totalMinutes < SECONDS_PER_MINUTE) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours < HOURS_PER_DAY) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  const remainingHours = hours % HOURS_PER_DAY;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function MetricSlab({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border-2 border-border bg-background/75 p-3 shadow-[3px_3px_0_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between text-primary">
        {icon}
        <span className="text-[10px] uppercase tracking-[0.28em]">Live</span>
      </div>
      <div className="mt-3 font-mono font-semibold text-3xl text-foreground">
        {value}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground uppercase tracking-[0.28em]">
        {label}
      </div>
    </div>
  );
}

function CellConstellation({ homeCells }: { homeCells: HomeCell[] }) {
  const visibleCells = homeCells.slice(0, MAX_CONSTELLATION_CELLS);
  const overflowCount = Math.max(homeCells.length - visibleCells.length, 0);

  return (
    <Card className="overflow-hidden border-2 border-border bg-card shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
      <CardHeader className="border-border border-b-2 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] text-primary uppercase tracking-[0.38em]">
              Cell constellation
            </div>
            <CardTitle className="mt-1 text-xl uppercase tracking-[0.16em]">
              Running cell lattice
            </CardTitle>
          </div>
          <Badge className="rounded-none" variant="secondary">
            {homeCells.length} total
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {homeCells.length === 0 ? (
          <EmptyTelemetry message="No cells yet. Create a cell to ignite the lattice." />
        ) : (
          <div className="relative min-h-[340px] overflow-hidden border-2 border-border bg-background/65 p-4">
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_hsl(var(--primary)/0.14),_transparent_54%),_linear-gradient(transparent_23px,_hsl(var(--border)/0.35)_24px),_linear-gradient(90deg,_transparent_23px,_hsl(var(--border)/0.35)_24px)] bg-[size:auto,24px_24px,24px_24px]"
            />
            <div className="relative grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5 lg:grid-cols-7">
              {visibleCells.map((homeCell, index) => {
                const tone = getCellConstellationTone(homeCell);
                return (
                  <Link
                    aria-label={`${homeCell.cell.name} in ${homeCell.workspace.label}: ${homeCell.cell.status}`}
                    className={cn(
                      "group hover:-translate-y-0.5 min-w-0 translate-y-0 border-2 p-3 text-left transition-none [clip-path:polygon(25%_6%,75%_6%,100%_50%,75%_94%,25%_94%,0_50%)] hover:shadow-[0_0_28px_hsl(var(--primary)/0.24)] focus:outline-none focus:ring-2 focus:ring-primary",
                      index % 2 === 1 &&
                        "sm:translate-y-7 sm:hover:translate-y-6",
                      tone
                    )}
                    key={homeCell.cell.id}
                    params={{ cellId: homeCell.cell.id }}
                    search={{ workspaceId: homeCell.cell.workspaceId }}
                    to="/cells/$cellId/chat"
                  >
                    <div className="flex aspect-square flex-col items-center justify-center text-center">
                      <span className="font-mono font-semibold text-lg uppercase leading-none tracking-[0.16em]">
                        {getCellInitials(homeCell.cell.name)}
                      </span>
                      <span className="mt-2 line-clamp-2 max-w-[7rem] text-[10px] uppercase leading-4 tracking-[0.14em] opacity-80">
                        {homeCell.cell.name}
                      </span>
                    </div>
                  </Link>
                );
              })}
              {overflowCount > 0 ? (
                <div className="flex min-h-24 items-center justify-center border-2 border-border border-dashed bg-muted/20 p-3 text-center font-mono text-muted-foreground text-sm uppercase tracking-[0.22em] [clip-path:polygon(25%_6%,75%_6%,100%_50%,75%_94%,25%_94%,0_50%)]">
                  +{overflowCount} more
                </div>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceSignalStrip({ serviceStats }: { serviceStats: ServiceStats }) {
  const segments = [
    {
      className: "bg-primary",
      count: serviceStats.running,
      label: "Running",
    },
    {
      className: "bg-[#2DD4BF]",
      count: serviceStats.starting,
      label: "Starting",
    },
    {
      className: "bg-muted-foreground",
      count: serviceStats.stopped,
      label: "Stopped",
    },
    {
      className: "bg-destructive",
      count: serviceStats.error,
      label: "Error",
    },
  ].filter((segment) => segment.count > 0);
  const resourceStats = [
    serviceStats.peakCpuPercent > 0
      ? {
          label: "Peak CPU",
          value: formatCpuPercent(serviceStats.peakCpuPercent),
        }
      : null,
    serviceStats.totalRssBytes > 0
      ? {
          label: "Total RSS",
          value: formatBytes(serviceStats.totalRssBytes),
        }
      : null,
  ].filter((stat) => stat !== null);

  return (
    <Card className="border-2 border-border bg-card shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
      <CardHeader className="border-border border-b-2 pb-4">
        <div className="text-[10px] text-primary uppercase tracking-[0.38em]">
          Service signal
        </div>
        <CardTitle className="text-xl uppercase tracking-[0.16em]">
          Service process status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        {resourceStats.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {resourceStats.map((stat) => (
              <SignalStat
                key={stat.label}
                label={stat.label}
                value={stat.value}
              />
            ))}
          </div>
        ) : null}
        <div className="space-y-3">
          {segments.map((segment) => (
            <div className="space-y-1" key={segment.label}>
              <div className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.22em]">
                <span className="text-muted-foreground">{segment.label}</span>
                <span className="text-foreground">{segment.count}</span>
              </div>
              <div className="h-3 border border-border bg-background">
                <div
                  className={cn("h-full", segment.className)}
                  style={{
                    width: `${getSegmentPercent(segment.count, serviceStats.total)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {serviceStats.total === 0 ? (
          <EmptyTelemetry message="No service telemetry yet. Ready cells with services will populate this strip." />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SignalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-border bg-background/70 p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-[0.28em]">
        {label}
      </div>
      <div className="mt-2 font-mono font-semibold text-foreground text-xl">
        {value}
      </div>
    </div>
  );
}

function RunningCellsPanel({
  pathname,
  runningCells,
}: {
  pathname: string;
  runningCells: HomeCell[];
}) {
  if (runningCells.length === 0) {
    return null;
  }

  const cellsToShow = runningCells;

  return (
    <Card className="border-2 border-border bg-card shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
      <CardHeader className="border-border border-b-2 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] text-primary uppercase tracking-[0.38em]">
              Running cells
            </div>
            <CardTitle className="text-xl uppercase tracking-[0.16em]">
              Active operations
            </CardTitle>
          </div>
          <Badge className="rounded-none" variant="secondary">
            {runningCells.length} active
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/70">
          {cellsToShow.map((homeCell) => {
            const isActive = pathname.startsWith(`/cells/${homeCell.cell.id}`);
            return (
              <div
                className={cn(
                  "grid grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(220px,1.15fr)_minmax(180px,0.7fr)_minmax(260px,1fr)]",
                  isActive &&
                    "bg-primary/5 shadow-[inset_4px_0_0_0_hsl(var(--primary))]"
                )}
                key={homeCell.cell.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      className="min-w-0 truncate font-semibold text-foreground hover:text-primary"
                      params={{ cellId: homeCell.cell.id }}
                      search={{ workspaceId: homeCell.cell.workspaceId }}
                      to="/cells/$cellId/chat"
                    >
                      {homeCell.cell.name}
                    </Link>
                    <StatusBadge status={homeCell.cell.status} />
                    {homeCell.agentSession ? (
                      <AgentModeBadge session={homeCell.agentSession} />
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-2 text-muted-foreground text-sm">
                    {homeCell.cell.description || "No description."}
                  </p>
                </div>

                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                    Workspace / template
                  </div>
                  <div className="mt-2 truncate font-mono text-[11px] text-foreground">
                    {homeCell.workspace.label}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {homeCell.templateLabel ?? "No template"}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                    Services
                  </div>
                  <div className="mt-2">
                    <ServicesSummary
                      cellStatus={homeCell.cell.status}
                      services={homeCell.servicesState?.services}
                      servicesError={homeCell.servicesState?.isError}
                      servicesLoading={homeCell.servicesState?.isLoading}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentModeBadge({ session }: { session: AgentSession }) {
  const isActive = isActiveAgentSession(session);
  return (
    <span
      className={cn(
        "border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.24em]",
        isActive
          ? "border-primary/70 bg-primary/15 text-primary"
          : "border-border bg-muted/20 text-muted-foreground"
      )}
    >
      {session.currentMode ?? session.startMode ?? session.status}
    </span>
  );
}

function EmptyTelemetry({ message }: { message: string }) {
  return (
    <div className="border-2 border-border border-dashed bg-muted/10 p-4 text-muted-foreground text-sm">
      {message}
    </div>
  );
}

function buildHomeCells({
  agentSessionStateByCellId,
  cellsByWorkspace,
  servicesByCellId,
  templatesByWorkspace,
  workspaces,
}: {
  agentSessionStateByCellId: Map<string, AgentSessionQueryState>;
  cellsByWorkspace: Map<string, CellSummary[]>;
  servicesByCellId: Map<string, ServiceQueryState>;
  templatesByWorkspace: Map<string, TemplatesResponse>;
  workspaces: WorkspaceSummary[];
}): HomeCell[] {
  return workspaces.flatMap((workspace) => {
    const cells = cellsByWorkspace.get(workspace.id) ?? [];
    return cells.map((cell) => {
      const agentSessionState = agentSessionStateByCellId.get(cell.id);
      return {
        agentSession: agentSessionState?.session,
        agentSessionState,
        cell,
        servicesState: servicesByCellId.get(cell.id),
        templateLabel: getTemplateLabel(
          templatesByWorkspace.get(workspace.id),
          cell.templateId
        ),
        workspace,
      };
    });
  });
}

function getTemplateLabel(
  templates: TemplatesResponse | undefined,
  templateId: string | null | undefined
) {
  if (!templateId) {
    return;
  }
  return (
    templates?.templates.find((template) => template.id === templateId)
      ?.label ?? templateId
  );
}

function getServiceStats(homeCells: HomeCell[]): ServiceStats {
  const stats: ServiceStats = {
    error: 0,
    peakCpuPercent: 0,
    running: 0,
    starting: 0,
    stopped: 0,
    total: 0,
    totalRssBytes: 0,
  };

  for (const homeCell of homeCells) {
    for (const service of homeCell.servicesState?.services ?? []) {
      addServiceToStats(stats, service);
    }
  }

  return stats;
}

function addServiceToStats(stats: ServiceStats, service: CellServiceSummary) {
  const bucket = getServiceBucket(service.status);
  stats.total += 1;
  stats.totalRssBytes += service.rssBytes ?? 0;
  stats.peakCpuPercent = getMaxCpuPercent(
    stats.peakCpuPercent,
    service.cpuPercent
  );
  stats[bucket] += 1;
}

function getServiceBucket(
  status: string
): "error" | "running" | "starting" | "stopped" {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === "running") {
    return "running";
  }
  if (["starting", "pending", "needs_resume"].includes(normalizedStatus)) {
    return "starting";
  }
  if (normalizedStatus === "error") {
    return "error";
  }
  return "stopped";
}

function getMaxCpuPercent(
  currentMax: number,
  value: number | null | undefined
) {
  if (typeof value !== "number" || value <= currentMax) {
    return currentMax;
  }
  return value;
}

function isRunningCell(homeCell: HomeCell) {
  if (homeCell.cell.status !== "ready") {
    return false;
  }
  if (!homeCell.servicesState || homeCell.servicesState.isLoading) {
    return true;
  }
  const services = homeCell.servicesState.services;
  if (!services) {
    return true;
  }
  return services.some((service) => service.status.toLowerCase() === "running");
}

function isActiveAgentSession(session: AgentSession | null | undefined) {
  return ["starting", "working"].includes(session?.status ?? "");
}

function getRuntimeSummary(homeCells: HomeCell[]): RuntimeSummary {
  const summary: RuntimeSummary = {
    error: 0,
    idle: 0,
    none: 0,
    total: homeCells.length,
    working: 0,
  };
  for (const homeCell of homeCells) {
    summary[getRuntimeState(homeCell)] += 1;
  }
  return summary;
}

function getRuntimeState(homeCell: HomeCell): RuntimeState {
  if (
    homeCell.cell.status === "error" ||
    homeCell.agentSessionState?.isError ||
    homeCell.agentSession?.status === "error"
  ) {
    return "error";
  }
  if (!homeCell.agentSession) {
    return "none";
  }
  if (["starting", "working"].includes(homeCell.agentSession.status)) {
    return "working";
  }
  return "idle";
}

function getCellConstellationTone(homeCell: HomeCell) {
  if (homeCell.cell.status === "error" || homeCell.servicesState?.isError) {
    return "border-destructive/80 bg-destructive/15 text-destructive";
  }
  if (
    homeCell.servicesState?.services?.some(
      (service) => service.status === "running"
    )
  ) {
    return "border-[#2DD4BF]/80 bg-[#2DD4BF]/15 text-foreground";
  }
  if (homeCell.cell.status === "ready") {
    return "border-primary/80 bg-primary/15 text-primary";
  }
  if (["spawning", "pending"].includes(homeCell.cell.status)) {
    return "border-[#7C5BFF]/80 bg-[#7C5BFF]/15 text-foreground";
  }
  return "border-border bg-muted/25 text-muted-foreground";
}

function getCellInitials(name: string) {
  const parts = name
    .split(CELL_INITIAL_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts[0]?.[0] ?? "C") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
}

function getSegmentPercent(count: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return Math.max(
    MIN_SIGNAL_PERCENT,
    Math.round((count / total) * FULL_PERCENT)
  );
}

function StatusBadge({ status }: { status: CellStatus }) {
  const toneMap: Record<CellStatus, string> = {
    ready: "bg-primary/15 text-primary",
    pending: "bg-muted text-muted-foreground",
    spawning: "bg-secondary/20 text-secondary-foreground",
    error: "bg-destructive/10 text-destructive",
    deleting: "bg-destructive/20 text-destructive",
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

  const totalRssBytes = services.reduce(
    (total, service) => total + (service.rssBytes ?? 0),
    0
  );
  const maxCpuPercent = services.reduce(
    (max, service) =>
      typeof service.cpuPercent === "number" && service.cpuPercent > max
        ? service.cpuPercent
        : max,
    0
  );

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
      <p className="font-mono text-[11px] text-muted-foreground">
        Live snapshot: RSS {formatBytes(totalRssBytes)} · Peak CPU{" "}
        {formatCpuPercent(maxCpuPercent)}
      </p>
    </div>
  );
}

function ServiceStatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-[0.3em]",
        serviceStatusTone(status)
      )}
    >
      {status}
    </span>
  );
}
