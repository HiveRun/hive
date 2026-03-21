import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type CellResourceSummary,
  type CellStatus,
  cellQueries,
} from "@/queries/cells";
import { workspaceQueries } from "@/queries/workspaces";

const RESOURCES_REFETCH_INTERVAL_MS = 15_000;
const RESOURCE_HISTORY_POINTS_LIMIT = 180;
const BYTES_PER_UNIT = 1024;
const ZERO_DECIMALS = 0;
const ONE_DECIMAL = 1;
const CPU_LOW_SIGNAL_THRESHOLD_PERCENT = 0.1;
const CPU_NO_DECIMAL_THRESHOLD_PERCENT = 100;
const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 28;
const SPARKLINE_PADDING = 2;
const SPARKLINE_MAX_POINTS = 48;
const DETAIL_SPARKLINE_WIDTH = 300;
const DETAIL_SPARKLINE_HEIGHT = 72;
const PROCESS_SPARKLINE_WIDTH = 96;
const PROCESS_SPARKLINE_HEIGHT = 24;
const P95_PERCENTILE = 0.95;
const AUTO_FOLLOW_DEFAULT = true;
// biome-ignore lint/style/noMagicNumbers: anomaly threshold values are intentional product defaults.
const IDLE_HEAVY_RAM_THRESHOLD_BYTES = 100 * BYTES_PER_UNIT * BYTES_PER_UNIT;
const IDLE_HEAVY_CPU_THRESHOLD_PERCENT = 0.2;
// biome-ignore lint/style/noMagicNumbers: anomaly threshold values are intentional product defaults.
const RAM_GROWTH_MIN_DELTA_BYTES = 20 * BYTES_PER_UNIT * BYTES_PER_UNIT;
const RAM_GROWTH_MIN_RATIO = 1.3;
const CPU_SPIKE_MIN_PERCENT = 1;
const CPU_SPIKE_MULTIPLIER = 1.5;
const STALE_SAMPLE_THRESHOLD_MS = 45_000;
const NOW_TICK_INTERVAL_MS = 1000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

type GlobalResourceRow = {
  id: string;
  workspaceLabel: string;
  name: string;
  status: CellStatus;
  summary?: CellResourceSummary;
};

type SortMetric = "activeRam" | "activeCpu" | "peakRam" | "peakCpu";

const globalResourcesSearchSchema = z.object({
  sort: z.enum(["activeRam", "activeCpu", "peakRam", "peakCpu"]).optional(),
  cell: z.string().optional(),
  follow: z.coerce.boolean().optional(),
});

type GlobalResourcesSearch = z.infer<typeof globalResourcesSearchSchema>;

type TrendStats = {
  current: number;
  average: number;
  peak: number;
  p95: number;
  samples: number;
};

type ResourceProcess = CellResourceSummary["processes"][number];

type EnrichedResourceRow = GlobalResourceRow & {
  latestSampleLabel: string;
  processLabel: string;
  cpuSeries: number[];
  ramSeries: number[];
  cpuStats: TrendStats;
  ramStats: TrendStats;
};

type ResourceTypeGroup = {
  key: string;
  label: string;
  count: number;
  activeCount: number;
  activeCpu: number;
  activeRam: number;
  totalRam: number;
};

type ProcessTrend = {
  cpuSeries: number[];
  ramSeries: number[];
  cpuStats: TrendStats;
  ramStats: TrendStats;
};

type DetailTab = "overview" | "processes";

type FreshnessInfo = {
  label: string;
  isStale: boolean;
};

type GlobalChartMode = "active" | "peak";

type ResourceHistoryAverage = NonNullable<
  CellResourceSummary["historyAverages"]
>[number];

export const Route = createFileRoute("/global-resources")({
  validateSearch: (search) => globalResourcesSearchSchema.parse(search),
  component: GlobalResourcesRoute,
});

function GlobalResourcesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sortMetric = (search.sort ?? "activeRam") as SortMetric;
  const selectedCellId = search.cell ?? null;
  const autoFollowTop = search.follow ?? AUTO_FOLLOW_DEFAULT;
  const workspaceQuery = useQuery(workspaceQueries.list());
  const workspaces = workspaceQuery.data?.workspaces ?? [];

  const updateSearch = useCallback(
    (updater: (current: GlobalResourcesSearch) => GlobalResourcesSearch) => {
      navigate({
        to: "/global-resources",
        search: updater,
        replace: true,
      });
    },
    [navigate]
  );

  const cellListQueries = useQueries({
    queries: workspaces.map((workspace) => {
      const config = cellQueries.all(workspace.id);
      return {
        queryKey: config.queryKey,
        queryFn: config.queryFn,
      };
    }),
  });

  const cells = workspaces.flatMap((workspace, index) => {
    const workspaceCells = cellListQueries[index]?.data ?? [];
    return workspaceCells.map((cell) => ({
      ...cell,
      workspaceLabel: workspace.label,
    }));
  });

  const resourceQueries = useQueries({
    queries: cells.map((cell) => {
      const config = cellQueries.resources(cell.id, {
        includeHistory: true,
        includeAverages: true,
        historyLimit: RESOURCE_HISTORY_POINTS_LIMIT,
      });
      return {
        queryKey: config.queryKey,
        queryFn: config.queryFn,
        enabled: cell.status === "ready",
        staleTime: 0,
        refetchInterval:
          cell.status === "ready" ? RESOURCES_REFETCH_INTERVAL_MS : false,
      };
    }),
  });

  const rows = useMemo(() => {
    const baseRows = cells.map((cell, index) => ({
      ...cell,
      summary:
        cell.status === "ready" ? resourceQueries[index]?.data : undefined,
    }));
    const enriched = baseRows.map(toEnrichedResourceRow);
    return enriched.sort(
      (left, right) =>
        metricValue(right, sortMetric) - metricValue(left, sortMetric)
    );
  }, [cells, resourceQueries, sortMetric]);

  const totals = useMemo(() => summarizeRows(rows), [rows]);
  const resourceTypeGroups = useMemo(
    () => summarizeResourceTypeGroups(rows),
    [rows]
  );
  const freshness = useMemo(
    () => buildFreshnessInfo(rows, nowMs),
    [rows, nowMs]
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, NOW_TICK_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedCellId !== null) {
        updateSearch((current) => ({
          ...current,
          cell: undefined,
        }));
      }
      return;
    }

    const topCellId = rows[0]?.id ?? null;
    if (autoFollowTop && topCellId && selectedCellId !== topCellId) {
      updateSearch((current) => ({
        ...current,
        cell: topCellId,
      }));
      return;
    }

    if (selectedCellId && rows.some((row) => row.id === selectedCellId)) {
      return;
    }

    if (topCellId) {
      updateSearch((current) => ({
        ...current,
        cell: topCellId,
      }));
    }
  }, [autoFollowTop, rows, selectedCellId, updateSearch]);

  const selectedRow = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }

    return rows.find((row) => row.id === selectedCellId) ?? rows[0] ?? null;
  }, [rows, selectedCellId]);

  const handleRefresh = () => {
    Promise.all([
      workspaceQuery.refetch(),
      ...cellListQueries.map((query) => query.refetch()),
      ...resourceQueries.map((query) => query.refetch()),
    ]).catch(() => {
      return;
    });
  };

  if (workspaceQuery.isLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground text-sm">
        Loading resources…
      </div>
    );
  }

  if (workspaceQuery.error instanceof Error) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-destructive/50 bg-destructive/10 text-destructive text-sm">
        {workspaceQuery.error.message}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4 text-sm">
        <header className="flex flex-wrap items-start justify-between gap-3 border-border/60 border-b pb-2">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-foreground text-lg uppercase tracking-[0.25em]">
              Global Resources
            </h2>
            <p className="text-muted-foreground text-xs">
              Current + historical CPU/RAM by cell with usage ranking.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.22em]">
              {rows.length} cell{rows.length === 1 ? "" : "s"}
            </p>
            <Button
              onClick={handleRefresh}
              size="sm"
              type="button"
              variant="ghost"
            >
              Refresh
            </Button>
          </div>
        </header>

        <OverviewCards rows={rows} totals={totals} />
        <GlobalOverviewCharts rows={rows} totals={totals} />
        <ResourceTypeSummary groups={resourceTypeGroups} />

        <SortControls
          autoFollowTop={autoFollowTop}
          freshness={freshness}
          onChange={(metric) => {
            updateSearch((current) => ({
              ...current,
              sort: metric,
            }));
          }}
          onToggleAutoFollow={(enabled) => {
            const topCellId = rows[0]?.id;
            updateSearch((current) => ({
              ...current,
              follow: enabled,
              ...(enabled ? { cell: topCellId } : {}),
            }));
          }}
          sortMetric={sortMetric}
        />

        <section className="min-h-0 flex-1 overflow-hidden border border-border/70 bg-muted/10 p-3">
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="h-[34vh] max-h-[360px] min-h-[180px]">
              {rows.length === 0 ? (
                <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
                  No cells available.
                </div>
              ) : (
                <ResourcesTable
                  nowMs={nowMs}
                  onSelectCell={(cellId) => {
                    updateSearch((current) => ({
                      ...current,
                      follow: false,
                      cell: cellId,
                    }));
                  }}
                  rows={rows}
                  selectedCellId={selectedRow?.id ?? null}
                  sortMetric={sortMetric}
                />
              )}
            </div>
            <CellDetailPanel
              key={selectedRow?.id ?? "none"}
              row={selectedRow}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function OverviewCards({
  rows,
  totals,
}: {
  rows: EnrichedResourceRow[];
  totals: {
    activeCpu: number;
    activeRam: number;
    peakCpu: number;
    peakRam: number;
  };
}) {
  const topCpu = [...rows].sort(
    (left, right) => right.cpuStats.current - left.cpuStats.current
  )[0];
  const topRam = [...rows].sort(
    (left, right) => right.ramStats.current - left.ramStats.current
  )[0];

  const cards = [
    {
      label: "Current Active CPU",
      value: formatCpuPercent(totals.activeCpu),
      note: `Peak ${formatCpuPercent(totals.peakCpu)}`,
    },
    {
      label: "Current Active RAM",
      value: formatBytes(totals.activeRam),
      note: `Peak ${formatBytes(totals.peakRam)}`,
    },
    {
      label: "Top CPU Cell",
      value: topCpu ? topCpu.name : "-",
      note: topCpu ? formatCpuPercent(topCpu.cpuStats.current) : "-",
    },
    {
      label: "Top RAM Cell",
      value: topRam ? topRam.name : "-",
      note: topRam ? formatBytes(topRam.ramStats.current) : "-",
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          className="border border-border/70 bg-background/30 px-3 py-2"
          key={card.label}
        >
          <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
            {card.label}
          </p>
          <p className="font-mono text-base text-foreground">{card.value}</p>
          <p className="text-[11px] text-muted-foreground">{card.note}</p>
        </div>
      ))}
    </div>
  );
}

function GlobalOverviewCharts({
  rows,
  totals,
}: {
  rows: EnrichedResourceRow[];
  totals: {
    activeCpu: number;
    activeRam: number;
    peakCpu: number;
    peakRam: number;
  };
}) {
  const [mode, setMode] = useState<GlobalChartMode>("active");
  const series = useMemo(() => aggregateCellHistorySeries(rows), [rows]);
  const modeCpuSeries =
    mode === "active" ? series.activeCpuSeries : series.peakCpuSeries;
  const modeRamSeries =
    mode === "active" ? series.activeRamSeries : series.peakRamSeries;
  const currentPeakCpu = rows.reduce(
    (peak, row) => Math.max(peak, row.cpuStats.current),
    0
  );
  const currentPeakRam = rows.reduce(
    (peak, row) => Math.max(peak, row.ramStats.current),
    0
  );
  const cpuStats = buildTrendStats(
    modeCpuSeries,
    mode === "active" ? totals.activeCpu : currentPeakCpu
  );
  const ramStats = buildTrendStats(
    modeRamSeries,
    mode === "active" ? totals.activeRam : currentPeakRam
  );

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden border border-border/80">
          <Button
            className={cn(
              "h-7 rounded-none border-0 border-border/80 border-r px-2 text-[11px] tracking-[0.04em]",
              mode === "active"
                ? "bg-primary/15 text-foreground"
                : "bg-background/30 text-muted-foreground"
            )}
            onClick={() => setMode("active")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Active total
          </Button>
          <Button
            className={cn(
              "h-7 rounded-none border-0 px-2 text-[11px] tracking-[0.04em]",
              mode === "peak"
                ? "bg-primary/15 text-foreground"
                : "bg-background/30 text-muted-foreground"
            )}
            onClick={() => setMode("peak")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Peak cell
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {mode === "active"
            ? "Active mode sums all cells per sample"
            : "Peak mode tracks highest single-cell sample"}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="border border-border/60 bg-background/20 p-2">
          <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
            All Cells CPU History ({mode})
          </p>
          <div className="mt-1">
            <Sparkline
              height={DETAIL_SPARKLINE_HEIGHT}
              values={modeCpuSeries}
              variant="cpu"
              width={DETAIL_SPARKLINE_WIDTH}
            />
          </div>
          <p className="mt-1 font-mono text-muted-foreground text-xs">
            now {formatCpuPercent(cpuStats.current)} · avg{" "}
            {formatCpuPercent(cpuStats.average)} · p95{" "}
            {formatCpuPercent(cpuStats.p95)}· peak{" "}
            {formatCpuPercent(cpuStats.peak)}
          </p>
        </div>
        <div className="border border-border/60 bg-background/20 p-2">
          <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
            All Cells RAM History ({mode})
          </p>
          <div className="mt-1">
            <Sparkline
              height={DETAIL_SPARKLINE_HEIGHT}
              values={modeRamSeries}
              variant="ram"
              width={DETAIL_SPARKLINE_WIDTH}
            />
          </div>
          <p className="mt-1 font-mono text-muted-foreground text-xs">
            now {formatBytes(ramStats.current)} · avg{" "}
            {formatBytes(ramStats.average)} · peak {formatBytes(ramStats.peak)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ResourceTypeSummary({ groups }: { groups: ResourceTypeGroup[] }) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {groups.map((group) => (
        <div
          className="border border-border/70 bg-background/20 px-3 py-2"
          key={group.key}
        >
          <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
            {group.label}
          </p>
          <p className="font-mono text-foreground text-sm">
            active {group.activeCount}/{group.count}
          </p>
          <p className="font-mono text-muted-foreground text-xs">
            cpu {formatCpuPercent(group.activeCpu)}
          </p>
          <p className="font-mono text-muted-foreground text-xs">
            ram {formatBytes(group.activeRam)} / {formatBytes(group.totalRam)}
          </p>
        </div>
      ))}
    </div>
  );
}

function SortControls({
  sortMetric,
  onChange,
  autoFollowTop,
  onToggleAutoFollow,
  freshness,
}: {
  sortMetric: SortMetric;
  onChange: (metric: SortMetric) => void;
  autoFollowTop: boolean;
  onToggleAutoFollow: (enabled: boolean) => void;
  freshness: FreshnessInfo;
}) {
  const options: Array<{ metric: SortMetric; label: string }> = [
    { metric: "activeRam", label: "Active RAM" },
    { metric: "activeCpu", label: "Active CPU" },
    { metric: "peakRam", label: "Peak RAM" },
    { metric: "peakCpu", label: "Peak CPU" },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground text-xs">Rank by</p>
        <div className="inline-flex overflow-hidden border border-border/80">
          {options.map((option) => (
            <Button
              className={cn(
                "h-7 rounded-none border-0 border-border/80 border-r px-2 text-[11px] tracking-[0.04em] last:border-r-0",
                sortMetric === option.metric
                  ? "bg-primary/15 text-foreground"
                  : "bg-background/30 text-muted-foreground"
              )}
              key={option.metric}
              onClick={() => onChange(option.metric)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {sortMetric === option.metric ? "● " : ""}
              {option.label}
            </Button>
          ))}
        </div>
        <Button
          className={cn(
            "h-7 rounded-none border border-border/80 px-2 text-[11px] tracking-[0.04em]",
            autoFollowTop
              ? "bg-primary/15 text-foreground"
              : "bg-background/30 text-muted-foreground"
          )}
          onClick={() => onToggleAutoFollow(!autoFollowTop)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {autoFollowTop ? "Auto-follow on" : "Auto-follow off"}
        </Button>
      </div>
      <p
        className={cn(
          "font-mono text-xs",
          freshness.isStale ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {freshness.label}
      </p>
    </div>
  );
}

function ResourcesTable({
  sortMetric,
  nowMs,
  rows,
  selectedCellId,
  onSelectCell,
}: {
  sortMetric: SortMetric;
  nowMs: number;
  rows: EnrichedResourceRow[];
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
}) {
  const cpuLabel = cpuHeaderLabel(sortMetric);
  const ramLabel = ramHeaderLabel(sortMetric);

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>Cell</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Active</TableHead>
            <TableHead>{cpuLabel}</TableHead>
            <TableHead>{ramLabel}</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <ResourcesRow
              isSelected={selectedCellId === row.id}
              key={row.id}
              nowMs={nowMs}
              onSelect={onSelectCell}
              row={row}
            />
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function ResourcesRow({
  row,
  nowMs,
  onSelect,
  isSelected,
}: {
  row: EnrichedResourceRow;
  nowMs: number;
  onSelect: (cellId: string) => void;
  isSelected: boolean;
}) {
  const summary = row.summary;
  const anomalies = detectRowAnomalies(row);
  const visibleAnomalies = anomalies.slice(0, 2);

  return (
    <TableRow
      className={cn(
        "cursor-pointer border-border/60 border-b",
        isSelected
          ? "bg-primary/12 shadow-[inset_3px_0_0_hsl(var(--primary))]"
          : "bg-background/5 hover:bg-background/25"
      )}
      onClick={() => onSelect(row.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(row.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <TableCell className="max-w-[240px] text-sm">
        <div className="flex flex-col gap-1">
          <span className="truncate font-medium text-foreground">
            {row.name}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.workspaceLabel}
          </span>
          {visibleAnomalies.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {visibleAnomalies.map((anomaly) => (
                <span
                  className="rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                  key={anomaly}
                >
                  {anomaly}
                </span>
              ))}
              {anomalies.length > visibleAnomalies.length ? (
                <span className="rounded-sm border border-border/60 bg-background/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  +{anomalies.length - visibleAnomalies.length}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "inline-flex rounded-sm border px-2 py-0.5 font-mono text-[11px]",
            statusClass(row.status)
          )}
        >
          {row.status}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {row.processLabel}
      </TableCell>
      <TableCell className="min-w-[120px]">
        {summary ? (
          <p className="font-mono text-foreground text-sm tabular-nums">
            {formatCpuPercent(row.cpuStats.current)}
          </p>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </TableCell>
      <TableCell className="min-w-[120px]">
        {summary ? (
          <p className="font-mono text-foreground text-sm tabular-nums">
            {formatBytes(row.ramStats.current)}
          </p>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </TableCell>
      <TableCell className="font-mono text-muted-foreground text-xs">
        <div className="space-y-0.5">
          <p>{row.latestSampleLabel}</p>
          <p className="text-[11px]">
            {sampleAgeLabel(summary?.sampledAt, nowMs)}
          </p>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CellDetailPanel({ row }: { row: EnrichedResourceRow | null }) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  if (!row?.summary) {
    return (
      <div className="border border-border/60 bg-background/20 px-3 py-2 text-muted-foreground text-xs">
        Select a ready cell to inspect process-level details.
      </div>
    );
  }

  const processes = rankProcesses(row.summary.processes);
  const processTrendById = buildProcessTrendById(row.summary, processes);
  const historyAverages = row.summary.historyAverages ?? [];
  const breakdown = summarizeBreakdown(row.summary);

  return (
    <div className="grid gap-3 border border-border/70 bg-background/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
            Selected Cell
          </p>
          <p className="font-mono text-base text-foreground">
            {row.workspaceLabel} / {row.name}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-muted-foreground text-xs">
            {row.latestSampleLabel}
          </p>
          <p className="font-mono text-muted-foreground text-xs">
            {sampleAgeLabel(row.summary.sampledAt, Date.now())}
          </p>
        </div>
      </div>

      <DetailTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" ? (
        <div className="grid gap-3">
          <HistoryCharts row={row} />
          <HistoryAveragesStrip averages={historyAverages} />
          <div className="grid gap-2 md:grid-cols-3">
            <MetricCard
              label="Current CPU"
              primary={formatCpuPercent(row.cpuStats.current)}
              secondary={`avg ${formatCpuPercent(row.cpuStats.average)} · p95 ${formatCpuPercent(row.cpuStats.p95)} · peak ${formatCpuPercent(row.cpuStats.peak)}`}
            />
            <MetricCard
              label="Current RAM"
              primary={formatBytes(row.ramStats.current)}
              secondary={`avg ${formatBytes(row.ramStats.average)} · peak ${formatBytes(row.ramStats.peak)}`}
            />
            <MetricCard
              label="Process Mix"
              primary={row.processLabel}
              secondary={breakdown
                .filter((entry) => entry.total > 0)
                .map((entry) => `${entry.label} ${entry.active}/${entry.total}`)
                .join(" · ")}
            />
          </div>
        </div>
      ) : null}

      {activeTab === "processes" ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">CPU</TableHead>
                <TableHead className="text-right">RAM</TableHead>
                <TableHead>CPU Trend</TableHead>
                <TableHead>RAM Trend</TableHead>
                <TableHead className="text-right">PID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processes.map((process) => (
                <TableRow key={process.id}>
                  <TableCell className="text-xs">
                    {processKindLabel(process)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {process.name}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded-sm border px-1.5 py-0.5 font-mono text-[10px]",
                        process.active
                          ? "border-border/60 bg-background/40 text-foreground"
                          : "border-border/60 bg-background/20 text-muted-foreground"
                      )}
                    >
                      {process.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatCpuPercent(process.cpuPercent ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatBytes(process.rssBytes ?? 0)}
                  </TableCell>
                  <TableCell>
                    <ProcessTrendCell
                      metric="cpu"
                      trend={processTrendById.get(process.id) ?? null}
                    />
                  </TableCell>
                  <TableCell>
                    <ProcessTrendCell
                      metric="ram"
                      trend={processTrendById.get(process.id) ?? null}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground text-xs">
                    {process.pid ?? "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function HistoryCharts({ row }: { row: EnrichedResourceRow }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="border border-border/60 bg-background/20 p-2">
        <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
          CPU History
        </p>
        <div className="mt-1">
          <Sparkline
            height={DETAIL_SPARKLINE_HEIGHT}
            values={row.cpuSeries}
            variant="cpu"
            width={DETAIL_SPARKLINE_WIDTH}
          />
        </div>
        <p className="mt-1 font-mono text-muted-foreground text-xs">
          now {formatCpuPercent(row.cpuStats.current)} · avg{" "}
          {formatCpuPercent(row.cpuStats.average)} · p95{" "}
          {formatCpuPercent(row.cpuStats.p95)} · peak{" "}
          {formatCpuPercent(row.cpuStats.peak)}
        </p>
      </div>
      <div className="border border-border/60 bg-background/20 p-2">
        <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
          RAM History
        </p>
        <div className="mt-1">
          <Sparkline
            height={DETAIL_SPARKLINE_HEIGHT}
            values={row.ramSeries}
            variant="ram"
            width={DETAIL_SPARKLINE_WIDTH}
          />
        </div>
        <p className="mt-1 font-mono text-muted-foreground text-xs">
          now {formatBytes(row.ramStats.current)} · avg{" "}
          {formatBytes(row.ramStats.average)} · peak{" "}
          {formatBytes(row.ramStats.peak)}
        </p>
      </div>
    </div>
  );
}

function DetailTabs({
  activeTab,
  onChange,
}: {
  activeTab: DetailTab;
  onChange: (tab: DetailTab) => void;
}) {
  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "processes", label: "Processes" },
  ];

  return (
    <div className="inline-flex overflow-hidden border border-border/80">
      {tabs.map((tab) => (
        <Button
          className={cn(
            "h-7 rounded-none border-0 border-border/80 border-r px-2 text-[11px] tracking-[0.04em] last:border-r-0",
            activeTab === tab.id
              ? "bg-primary/15 text-foreground"
              : "bg-background/20 text-muted-foreground"
          )}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="border border-border/60 bg-background/20 p-2">
      <p className="text-[11px] text-muted-foreground tracking-[0.08em]">
        {label}
      </p>
      <p className="font-mono text-base text-foreground">{primary}</p>
      <p className="font-mono text-muted-foreground text-xs">{secondary}</p>
    </div>
  );
}

function HistoryAveragesStrip({
  averages,
}: {
  averages: ResourceHistoryAverage[];
}) {
  if (averages.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {averages.map((average) => (
        <div
          className="border border-border/60 bg-background/20 p-2"
          key={average.window}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            Avg {average.window}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            cpu {formatCpuPercent(average.averageActiveCpuPercent)}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            ram {formatBytes(average.averageActiveRssBytes)}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            peak {formatCpuPercent(average.peakActiveCpuPercent)} /{" "}
            {formatBytes(average.peakActiveRssBytes)}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            samples {average.sampleCount}
          </p>
        </div>
      ))}
    </div>
  );
}

function ProcessTrendCell({
  trend,
  metric,
}: {
  trend: ProcessTrend | null;
  metric: "cpu" | "ram";
}) {
  if (!trend) {
    return <span className="text-muted-foreground text-xs">-</span>;
  }

  if (metric === "cpu") {
    return (
      <div className="space-y-1">
        <Sparkline
          height={PROCESS_SPARKLINE_HEIGHT}
          values={trend.cpuSeries}
          variant="cpu"
          width={PROCESS_SPARKLINE_WIDTH}
        />
        <p className="font-mono text-[10px] text-muted-foreground">
          p95 {formatCpuPercent(trend.cpuStats.p95)} · peak{" "}
          {formatCpuPercent(trend.cpuStats.peak)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Sparkline
        height={PROCESS_SPARKLINE_HEIGHT}
        values={trend.ramSeries}
        variant="ram"
        width={PROCESS_SPARKLINE_WIDTH}
      />
      <p className="font-mono text-[10px] text-muted-foreground">
        peak {formatBytes(trend.ramStats.peak)}
      </p>
    </div>
  );
}

function buildProcessTrendById(
  summary: CellResourceSummary,
  processes: ResourceProcess[]
): Map<string, ProcessTrend> {
  const history = summary.history ?? [];
  const processById = new Map(
    processes.map((process) => [process.id, process])
  );
  const trends = new Map<string, ProcessTrend>();

  for (const process of processes) {
    const cpuSeries: number[] = [];
    const ramSeries: number[] = [];

    for (const point of history) {
      const historyProcess = point.processes.find(
        (candidate) => candidate.id === process.id
      );
      cpuSeries.push(historyProcess?.cpuPercent ?? 0);
      ramSeries.push(historyProcess?.rssBytes ?? 0);
    }

    if (cpuSeries.length === 0) {
      cpuSeries.push(process.cpuPercent ?? 0);
      ramSeries.push(process.rssBytes ?? 0);
    }

    const current = processById.get(process.id);
    trends.set(process.id, {
      cpuSeries,
      ramSeries,
      cpuStats: buildTrendStats(cpuSeries, current?.cpuPercent ?? 0),
      ramStats: buildTrendStats(ramSeries, current?.rssBytes ?? 0),
    });
  }

  return trends;
}

function aggregateCellHistorySeries(rows: EnrichedResourceRow[]): {
  activeCpuSeries: number[];
  activeRamSeries: number[];
  peakCpuSeries: number[];
  peakRamSeries: number[];
} {
  const maxSeriesLength = rows.reduce(
    (maxLength, row) =>
      Math.max(maxLength, row.cpuSeries.length, row.ramSeries.length),
    0
  );

  if (maxSeriesLength === 0) {
    return {
      activeCpuSeries: [],
      activeRamSeries: [],
      peakCpuSeries: [],
      peakRamSeries: [],
    };
  }

  const activeCpuSeries: number[] = [];
  const activeRamSeries: number[] = [];
  const peakCpuSeries: number[] = [];
  const peakRamSeries: number[] = [];

  for (let offset = maxSeriesLength; offset >= 1; offset -= 1) {
    let cpuTotal = 0;
    let ramTotal = 0;
    let cpuPeak = 0;
    let ramPeak = 0;
    let hasPoint = false;

    for (const row of rows) {
      const cpuPoint = row.cpuSeries.at(-offset);
      if (typeof cpuPoint === "number") {
        cpuTotal += cpuPoint;
        cpuPeak = Math.max(cpuPeak, cpuPoint);
        hasPoint = true;
      }

      const ramPoint = row.ramSeries.at(-offset);
      if (typeof ramPoint === "number") {
        ramTotal += ramPoint;
        ramPeak = Math.max(ramPeak, ramPoint);
        hasPoint = true;
      }
    }

    if (hasPoint) {
      activeCpuSeries.push(cpuTotal);
      activeRamSeries.push(ramTotal);
      peakCpuSeries.push(cpuPeak);
      peakRamSeries.push(ramPeak);
    }
  }

  return {
    activeCpuSeries,
    activeRamSeries,
    peakCpuSeries,
    peakRamSeries,
  };
}

function Sparkline({
  values,
  variant,
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
}: {
  values: number[];
  variant: "cpu" | "ram";
  width?: number;
  height?: number;
}) {
  const compact = compactSeries(values, SPARKLINE_MAX_POINTS);
  const path = toSparklinePath(compact, width, height);

  if (path == null) {
    return <span className="text-muted-foreground text-xs">Collecting…</span>;
  }

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "block",
        variant === "cpu" ? "text-primary" : "text-secondary"
      )}
      style={{ height, width }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        fill="none"
        points={path.points}
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx={path.lastX} cy={path.lastY} fill="currentColor" r="2" />
    </svg>
  );
}

function summarizeBreakdown(summary: CellResourceSummary) {
  const entries = [
    { kind: "service", label: "svc" },
    { kind: "opencode", label: "oc" },
    { kind: "terminal", label: "term" },
    { kind: "setup", label: "setup" },
  ] as const;

  return entries.map((entry) => {
    const matching = summary.processes.filter(
      (process) => process.kind === entry.kind
    );
    return {
      kind: entry.kind,
      label: entry.label,
      total: matching.length,
      active: matching.filter((process) => process.active).length,
    };
  });
}

function rankProcesses(processes: ResourceProcess[]): ResourceProcess[] {
  return [...processes].sort((left, right) => {
    if (left.active !== right.active) {
      return Number(right.active) - Number(left.active);
    }

    const rssDelta = (right.rssBytes ?? 0) - (left.rssBytes ?? 0);
    if (rssDelta !== 0) {
      return rssDelta;
    }

    return (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0);
  });
}

function processKindLabel(process: ResourceProcess): string {
  if (process.kind === "opencode") {
    return "OpenCode";
  }

  if (process.kind === "terminal") {
    return "Terminal";
  }

  if (process.kind === "setup") {
    return "Setup";
  }

  if (process.serviceType) {
    return `Service:${process.serviceType}`;
  }

  return "Service:unknown";
}

function summarizeResourceTypeGroups(
  rows: EnrichedResourceRow[]
): ResourceTypeGroup[] {
  const groups = new Map<string, ResourceTypeGroup>();

  for (const row of rows) {
    for (const process of row.summary?.processes ?? []) {
      const key = processTypeKey(process);
      const existing = groups.get(key) ?? {
        key,
        label: processTypeLabel(process),
        count: 0,
        activeCount: 0,
        activeCpu: 0,
        activeRam: 0,
        totalRam: 0,
      };

      existing.count += 1;
      existing.totalRam += process.rssBytes ?? 0;
      if (process.active) {
        existing.activeCount += 1;
        existing.activeCpu += process.cpuPercent ?? 0;
        existing.activeRam += process.rssBytes ?? 0;
      }

      groups.set(key, existing);
    }
  }

  return [...groups.values()].sort((left, right) => {
    const ramDelta = right.activeRam - left.activeRam;
    if (ramDelta !== 0) {
      return ramDelta;
    }
    return right.activeCpu - left.activeCpu;
  });
}

function processTypeKey(process: ResourceProcess): string {
  if (process.kind === "service") {
    return `service:${process.serviceType ?? "unknown"}`;
  }

  return process.kind;
}

function processTypeLabel(process: ResourceProcess): string {
  if (process.kind === "service") {
    return `service/${process.serviceType ?? "unknown"}`;
  }

  return process.kind;
}

function summarizeRows(rows: EnrichedResourceRow[]) {
  return rows.reduce(
    (accumulator, row) => ({
      activeCpu: accumulator.activeCpu + row.cpuStats.current,
      activeRam: accumulator.activeRam + row.ramStats.current,
      peakCpu: Math.max(accumulator.peakCpu, row.cpuStats.peak),
      peakRam: Math.max(accumulator.peakRam, row.ramStats.peak),
    }),
    {
      activeCpu: 0,
      activeRam: 0,
      peakCpu: 0,
      peakRam: 0,
    }
  );
}

function detectRowAnomalies(row: EnrichedResourceRow): string[] {
  if (!row.summary) {
    return [];
  }

  const anomalies: string[] = [];

  const cpuSpikeThreshold = Math.max(
    row.cpuStats.p95 * CPU_SPIKE_MULTIPLIER,
    CPU_SPIKE_MIN_PERCENT
  );
  if (row.cpuStats.current >= cpuSpikeThreshold) {
    anomalies.push("CPU Spike");
  }

  const firstRam = row.ramSeries[0] ?? row.ramStats.current;
  const ramGrowth = row.ramStats.current - firstRam;
  if (
    ramGrowth >= RAM_GROWTH_MIN_DELTA_BYTES &&
    row.ramStats.current >= firstRam * RAM_GROWTH_MIN_RATIO
  ) {
    anomalies.push("RAM Growth");
  }

  if (
    row.ramStats.current >= IDLE_HEAVY_RAM_THRESHOLD_BYTES &&
    row.cpuStats.current <= IDLE_HEAVY_CPU_THRESHOLD_PERCENT
  ) {
    anomalies.push("Idle Heavy RAM");
  }

  return anomalies;
}

function toEnrichedResourceRow(row: GlobalResourceRow): EnrichedResourceRow {
  if (!row.summary) {
    return {
      ...row,
      latestSampleLabel: "-",
      processLabel: "-",
      cpuSeries: [],
      ramSeries: [],
      cpuStats: emptyTrendStats(),
      ramStats: emptyTrendStats(),
    };
  }

  const history = row.summary.history ?? [];
  const cpuSeriesRaw = history.map((point) => point.activeCpuPercent);
  const ramSeriesRaw = history.map((point) => point.activeRssBytes);
  const cpuSeries =
    cpuSeriesRaw.length > 0 ? cpuSeriesRaw : [row.summary.activeCpuPercent];
  const ramSeries =
    ramSeriesRaw.length > 0 ? ramSeriesRaw : [row.summary.activeRssBytes];

  return {
    ...row,
    latestSampleLabel: formatSampleTime(row.summary.sampledAt),
    processLabel: `${row.summary.activeProcessCount}/${row.summary.processCount}`,
    cpuSeries,
    ramSeries,
    cpuStats: buildTrendStats(cpuSeries, row.summary.activeCpuPercent),
    ramStats: buildTrendStats(ramSeries, row.summary.activeRssBytes),
  };
}

function emptyTrendStats(): TrendStats {
  return {
    current: 0,
    average: 0,
    peak: 0,
    p95: 0,
    samples: 0,
  };
}

function metricValue(row: EnrichedResourceRow, sortMetric: SortMetric): number {
  if (sortMetric === "activeCpu") {
    return row.cpuStats.current;
  }

  if (sortMetric === "peakCpu") {
    return row.cpuStats.peak;
  }

  if (sortMetric === "peakRam") {
    return row.ramStats.peak;
  }

  return row.ramStats.current;
}

function buildTrendStats(values: number[], current: number): TrendStats {
  const sanitized = values.filter(
    (value) => Number.isFinite(value) && value >= 0
  );
  if (sanitized.length === 0) {
    return {
      current,
      average: current,
      peak: current,
      p95: current,
      samples: 1,
    };
  }

  const total = sanitized.reduce((sum, value) => sum + value, 0);
  const peak = sanitized.reduce((max, value) => (value > max ? value : max), 0);
  const p95 = percentile(sanitized, P95_PERCENTILE);

  return {
    current,
    average: total / sanitized.length,
    peak,
    p95,
    samples: sanitized.length,
  };
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(percentileValue * (sorted.length - 1))
  );
  return sorted[index] ?? 0;
}

function compactSeries(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) {
    return values;
  }

  const bucketSize = values.length / maxPoints;
  const compact: number[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const position = Math.floor(index * bucketSize);
    compact.push(values[position] ?? values.at(-1) ?? 0);
  }
  return compact;
}

function toSparklinePath(
  values: number[],
  width: number,
  height: number
): {
  points: string;
  lastX: number;
  lastY: number;
} | null {
  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const denominator = max - min || 1;
  const chartWidth = width - SPARKLINE_PADDING * 2;
  const chartHeight = height - SPARKLINE_PADDING * 2;

  const coordinates = values.map((value, index) => {
    const x =
      SPARKLINE_PADDING + (index / (values.length - 1 || 1)) * chartWidth;
    const y = SPARKLINE_PADDING + ((max - value) / denominator) * chartHeight;
    return { x, y };
  });

  const last = coordinates.at(-1);
  if (!last) {
    return null;
  }

  return {
    points: coordinates.map((coord) => `${coord.x},${coord.y}`).join(" "),
    lastX: last.x,
    lastY: last.y,
  };
}

function formatSampleTime(sampledAt: string): string {
  const timestamp = Date.parse(sampledAt);
  if (!Number.isFinite(timestamp)) {
    return "-";
  }
  return new Date(timestamp).toLocaleTimeString();
}

function parseSampleTimestamp(sampledAt?: string): number | null {
  if (!sampledAt) {
    return null;
  }

  const timestamp = Date.parse(sampledAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sampleAgeLabel(sampledAt: string | undefined, nowMs: number): string {
  const sampleMs = parseSampleTimestamp(sampledAt);
  if (sampleMs == null) {
    return "unknown";
  }

  const ageMs = Math.max(0, nowMs - sampleMs);
  const ageSeconds = Math.floor(ageMs / MS_PER_SECOND);
  if (ageSeconds < SECONDS_PER_MINUTE) {
    return `${ageSeconds}s ago`;
  }

  const ageMinutes = Math.floor(ageSeconds / SECONDS_PER_MINUTE);
  return `${ageMinutes}m ago`;
}

function buildFreshnessInfo(
  rows: EnrichedResourceRow[],
  nowMs: number
): FreshnessInfo {
  const sampleTimes = rows
    .map((row) => parseSampleTimestamp(row.summary?.sampledAt))
    .filter((value): value is number => value != null);

  const latestSampleMs = sampleTimes.reduce(
    (latest, timestamp) => Math.max(latest, timestamp),
    0
  );

  if (latestSampleMs <= 0) {
    return {
      label: "No samples yet",
      isStale: true,
    };
  }

  const ageMs = Math.max(0, nowMs - latestSampleMs);
  return {
    label: `Last update ${sampleAgeLabel(new Date(latestSampleMs).toISOString(), nowMs)}`,
    isStale: ageMs > STALE_SAMPLE_THRESHOLD_MS,
  };
}

function cpuHeaderLabel(sortMetric: SortMetric): string {
  if (sortMetric === "activeCpu") {
    return "CPU (active) ↓";
  }

  if (sortMetric === "peakCpu") {
    return "CPU (peak) ↓";
  }

  return "CPU";
}

function ramHeaderLabel(sortMetric: SortMetric): string {
  if (sortMetric === "activeRam") {
    return "RAM (active) ↓";
  }

  if (sortMetric === "peakRam") {
    return "RAM (peak) ↓";
  }

  return "RAM";
}

function statusClass(status: CellStatus): string {
  const toneMap: Record<CellStatus, string> = {
    ready: "border-border/60 bg-background/40 text-foreground",
    provisioning: "border-border/60 bg-background/20 text-muted-foreground",
    stopped: "border-border/60 bg-background/20 text-muted-foreground",
    error: "border-destructive/50 bg-destructive/10 text-destructive",
    deleting: "border-destructive/50 bg-destructive/10 text-destructive",
  };
  return toneMap[status];
}

function formatCpuPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "Unavailable";
  }

  if (value === 0) {
    return "0%";
  }

  if (value > 0 && value < CPU_LOW_SIGNAL_THRESHOLD_PERCENT) {
    return `<${CPU_LOW_SIGNAL_THRESHOLD_PERCENT}%`;
  }

  const decimals = value >= CPU_NO_DECIMAL_THRESHOLD_PERCENT ? 0 : 1;
  const asText = value.toFixed(decimals);
  const trimmed = decimals === 0 ? asText : trimTrailingZero(asText);
  return `${trimmed}%`;
}

function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "Unavailable";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= BYTES_PER_UNIT && unitIndex < units.length - 1) {
    size /= BYTES_PER_UNIT;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? ZERO_DECIMALS : ONE_DECIMAL)} ${units[unitIndex]}`;
}
