import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  type CellTimingRun,
  type CellTimingStatus,
  cellQueries,
} from "@/queries/cells";

const DEFAULT_TIMINGS_LIMIT = 200;
const MAX_TIMINGS_LIMIT = 1000;
const SHORT_RUN_ID_MAX_LENGTH = 10;
const SHORT_RUN_ID_PREFIX_LENGTH = 6;
const SHORT_RUN_ID_SUFFIX_LENGTH = 4;
const METADATA_DEFAULT_TRUNCATE = 48;
const METADATA_COMMAND_TRUNCATE = 52;
const METADATA_FALLBACK_LIMIT = 4;

const timingsSearchSchema = z.object({
  workflow: z.enum(["all", "create", "delete"]).optional(),
  runId: z.string().optional(),
  cellId: z.string().optional(),
  workspaceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TIMINGS_LIMIT).optional(),
});

type TimingWorkflowFilter = "all" | "create" | "delete";
type TimingsRouteSearch = z.infer<typeof timingsSearchSchema>;

export const Route = createFileRoute("/timings")({
  validateSearch: (search) => timingsSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({
    workflow: (search.workflow ?? "all") as TimingWorkflowFilter,
    runId: search.runId,
    cellId: search.cellId,
    workspaceId: search.workspaceId,
    limit: search.limit ?? DEFAULT_TIMINGS_LIMIT,
  }),
  loader: async ({ deps, context: { queryClient } }) => {
    await queryClient.ensureQueryData(
      cellQueries.timingsGlobal({
        workflow: deps.workflow,
        runId: deps.runId,
        cellId: deps.cellId,
        workspaceId: deps.workspaceId,
        limit: deps.limit,
      })
    );
  },
  component: GlobalTimingsRoute,
});

function GlobalTimingsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const workflow = (search.workflow ?? "all") as TimingWorkflowFilter;
  const limit = search.limit ?? DEFAULT_TIMINGS_LIMIT;

  const timingsQuery = useQuery(
    cellQueries.timingsGlobal({
      workflow,
      runId: search.runId,
      cellId: search.cellId,
      workspaceId: search.workspaceId,
      limit,
    })
  );

  const steps = timingsQuery.data?.steps ?? [];
  const runs = timingsQuery.data?.runs ?? [];

  const updateSearch = (
    updater: (current: TimingsRouteSearch) => TimingsRouteSearch
  ) => {
    navigate({
      to: "/timings",
      search: updater,
      replace: true,
    });
  };

  const setWorkflow = (next: TimingWorkflowFilter) => {
    if (next === workflow) {
      return;
    }

    updateSearch((current) => ({
      ...current,
      workflow: next,
      runId: undefined,
    }));
  };

  if (timingsQuery.isLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground text-sm">
        Loading timings...
      </div>
    );
  }

  if (timingsQuery.error instanceof Error) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-destructive/50 bg-destructive/10 text-destructive text-sm">
        {timingsQuery.error.message}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4 text-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-border/60 border-b pb-2">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-foreground text-lg uppercase tracking-[0.25em]">
              Global Timings
            </h2>
            <p className="text-muted-foreground text-xs">
              Creation and deletion phase durations across all cells.
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.22em]">
            {steps.length} step{steps.length === 1 ? "" : "s"} across{" "}
            {runs.length} run
            {runs.length === 1 ? "" : "s"}
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "All"],
              ["create", "Create"],
              ["delete", "Delete"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              onClick={() => setWorkflow(value)}
              size="sm"
              type="button"
              variant={workflow === value ? "secondary" : "outline"}
            >
              {label}
            </Button>
          ))}
          <Button
            onClick={() => timingsQuery.refetch()}
            size="sm"
            type="button"
            variant="ghost"
          >
            Refresh
          </Button>
        </div>

        <section className="flex min-h-0 flex-col gap-2 border border-border/70 bg-muted/10 p-3">
          <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.22em]">
            Runs
          </h3>
          {runs.length === 0 ? (
            <p className="text-muted-foreground text-xs">No timing runs yet.</p>
          ) : (
            <ScrollArea className="max-h-32">
              <div className="flex flex-wrap gap-2 pr-2">
                {runs.map((run) => (
                  <button
                    className={cn(
                      "inline-flex items-center gap-2 border px-2 py-1 text-[11px] uppercase tracking-[0.18em]",
                      search.runId === run.runId
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/70 bg-background/40 text-muted-foreground hover:bg-background/60"
                    )}
                    key={run.runId}
                    onClick={() =>
                      updateSearch((current) => ({
                        ...current,
                        runId:
                          current.runId === run.runId ? undefined : run.runId,
                      }))
                    }
                    type="button"
                  >
                    <span className="font-mono">{shortRunId(run.runId)}</span>
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        runStatusDotClass(run.status)
                      )}
                    />
                    <span>{run.workflow}</span>
                    <span>{formatDuration(run.totalDurationMs)}</span>
                    <span>{run.cellName ?? run.cellId}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </section>

        <section className="min-h-0 flex-1 overflow-hidden border border-border/70 bg-muted/10 p-3">
          {steps.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
              No timing steps found for this filter.
            </div>
          ) : (
            <ScrollArea className="h-full">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Cell</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {steps.map((step) => (
                    <TableRow key={step.id}>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatTimestamp(step.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        <Link
                          className="font-medium text-foreground underline-offset-2 hover:underline"
                          params={{ cellId: step.cellId }}
                          to="/cells/$cellId/chat"
                        >
                          {step.cellName ?? step.cellId}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortRunId(step.runId)}
                      </TableCell>
                      <TableCell className="uppercase">
                        {step.workflow}
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatStep(step.step)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]",
                            statusBadgeClass(step.status)
                          )}
                        >
                          {step.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatDuration(step.durationMs)}
                      </TableCell>
                      <TableCell className="max-w-[280px] whitespace-normal text-xs">
                        {formatTimingMetadata(step.metadata)}
                      </TableCell>
                      <TableCell className="max-w-[320px] whitespace-normal text-xs">
                        {step.error ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </section>
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${Math.max(0, Math.round(value))}ms`;
}

function formatStep(step: string): string {
  return step
    .replaceAll(":", " > ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTimingMetadata(metadata: Record<string, unknown>): string {
  const scalarDetails: string[] = [];
  const pushNumber = (label: string, key: string) => {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      scalarDetails.push(`${label}:${Math.round(value)}`);
    }
  };
  const pushString = (
    label: string,
    key: string,
    max = METADATA_DEFAULT_TRUNCATE
  ) => {
    const value = metadata[key];
    if (typeof value !== "string" || value.length === 0) {
      return;
    }

    scalarDetails.push(
      `${label}:${value.length > max ? `${value.slice(0, max - 1)}...` : value}`
    );
  };
  const pushBoolean = (label: string, key: string) => {
    const value = metadata[key];
    if (typeof value === "boolean") {
      scalarDetails.push(`${label}:${value ? "yes" : "no"}`);
    }
  };

  pushNumber("paths", "copiedPathCount");
  pushNumber("roots", "copiedRootCount");
  pushNumber("files", "copiedFileCount");
  pushNumber("reflink", "reflinkCopiedPathCount");
  pushNumber("fallback", "standardCopiedPathCount");
  pushBoolean("reflinkEnabled", "reflinkEnabled");
  pushNumber("includePatterns", "includePatternCount");
  pushNumber("ignorePatterns", "ignorePatternCount");
  pushString("service", "serviceName", 24);
  pushString("command", "command", METADATA_COMMAND_TRUNCATE);
  pushNumber("timeoutMs", "timeoutMs");

  if (scalarDetails.length > 0) {
    return scalarDetails.join(" | ");
  }

  const fallback = Object.entries(metadata)
    .filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value)
    )
    .slice(0, METADATA_FALLBACK_LIMIT)
    .map(([key, value]) => `${key}:${String(value)}`);

  return fallback.length > 0 ? fallback.join(" | ") : "-";
}

function shortRunId(runId: string): string {
  if (runId.length <= SHORT_RUN_ID_MAX_LENGTH) {
    return runId;
  }

  return `${runId.slice(0, SHORT_RUN_ID_PREFIX_LENGTH)}..${runId.slice(
    -SHORT_RUN_ID_SUFFIX_LENGTH
  )}`;
}

function statusBadgeClass(status: CellTimingStatus): string {
  if (status === "error") {
    return "border-destructive/60 bg-destructive/10 text-destructive";
  }

  return "border-emerald-500/60 bg-emerald-500/10 text-emerald-500";
}

function runStatusDotClass(status: CellTimingRun["status"]): string {
  if (status === "error") {
    return "bg-destructive";
  }

  return "bg-emerald-500";
}
