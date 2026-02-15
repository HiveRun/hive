import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { ProvisioningChecklistPanel } from "@/components/provisioning-checklist-panel";
import { Button } from "@/components/ui/button";
import { useCellStatusStream } from "@/hooks/use-cell-status-stream";
import { buildProvisioningChecklist } from "@/lib/provisioning-checklist";
import { cellMutations, cellQueries } from "@/queries/cells";

const PROVISIONING_POLL_MS = 1500;
const ignorePromiseRejection = (_error: unknown) => null;

export const Route = createFileRoute("/cells/$cellId/provisioning")({
  loader: ({ context: { queryClient }, params }) => {
    queryClient
      .prefetchQuery(cellQueries.detail(params.cellId))
      .catch(ignorePromiseRejection);
    queryClient
      .prefetchQuery(
        cellQueries.timings(params.cellId, { workflow: "create", limit: 300 })
      )
      .catch(ignorePromiseRejection);
    return null;
  },
  component: CellProvisioningRoute,
});

function CellProvisioningRoute() {
  const { cellId } = Route.useParams();
  const navigate = useNavigate({ from: "/cells/$cellId/provisioning" });
  const cellQuery = useQuery({
    ...cellQueries.detail(cellId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "spawning" || status === "pending"
        ? PROVISIONING_POLL_MS
        : false;
    },
  });
  const shouldPollTimeline =
    cellQuery.data?.status === "spawning" ||
    cellQuery.data?.status === "pending";
  const timingsQuery = useQuery({
    ...cellQueries.timings(cellId, { workflow: "create", limit: 300 }),
    enabled: Boolean(cellQuery.data),
    refetchInterval: shouldPollTimeline ? PROVISIONING_POLL_MS : false,
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
  const checklist = useMemo(
    () =>
      buildProvisioningChecklist({
        cellStatus: cellQuery.data?.status,
        steps: activeRunSteps,
      }),
    [activeRunSteps, cellQuery.data?.status]
  );
  const retryMutation = useMutation({
    mutationFn: cellMutations.retrySetup.mutationFn,
    onSuccess: () => {
      toast.success("Provisioning retry started");
      cellQuery.refetch().then(undefined, ignorePromiseRejection);
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Retry provisioning failed";
      toast.error(message);
    },
  });

  useEffect(() => {
    if (cellQuery.data?.status !== "ready") {
      return;
    }

    navigate({
      to: "/cells/$cellId/chat",
      params: { cellId },
      replace: true,
    }).then(undefined, ignorePromiseRejection);
  }, [cellId, cellQuery.data?.status, navigate]);

  const cell = cellQuery.data;
  const loadErrorMessage =
    cellQuery.error instanceof Error
      ? cellQuery.error.message
      : "Failed to load provisioning status";
  const isError = cell?.status === "error";
  const statusMessage = resolveProvisioningStatusMessage(cell?.status);

  useCellStatusStream(cell?.workspaceId ?? "", {
    enabled:
      Boolean(cell?.workspaceId) &&
      cell?.status !== "ready" &&
      cell?.status !== undefined,
  });

  if (cellQuery.isError) {
    return (
      <div className="flex h-full min-h-0 flex-1 overflow-auto rounded-sm border-2 border-border bg-card p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex w-full flex-col gap-3 border-2 border-destructive/60 bg-destructive/10 p-5">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <p className="font-medium text-[11px] uppercase tracking-[0.2em]">
                Unable to load cell
              </p>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {loadErrorMessage}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => cellQuery.refetch()}
                type="button"
                variant="secondary"
              >
                Retry load
              </Button>
              <Link to="/">
                <Button type="button" variant="outline">
                  Back to workspaces
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (cellQuery.isLoading || !cell) {
    return (
      <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
        <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 border-2 border-border/70 bg-muted/20 px-5 py-4">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
              Loading provisioning status
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full min-h-0 flex-1 overflow-auto rounded-sm border-2 border-border bg-card p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <ProvisioningChecklistPanel
            checklist={checklist}
            className="mt-0"
            statusMessage={statusMessage}
          />
          <div className="flex w-full flex-col gap-3 border-2 border-destructive/60 bg-destructive/10 p-5">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <p className="font-medium text-[11px] uppercase tracking-[0.2em]">
                Provisioning failed
              </p>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {cell.lastSetupError ??
                "Startup failed before chat became available. Retry provisioning or inspect setup logs."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate(cellId)}
                type="button"
                variant="secondary"
              >
                {retryMutation.isPending ? "Retrying..." : "Retry provisioning"}
              </Button>
              <Link params={{ cellId }} to="/cells/$cellId/setup">
                <Button type="button" variant="outline">
                  Open setup logs
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card p-4 lg:p-6">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl">
        <ProvisioningChecklistPanel
          checklist={checklist}
          className="mt-0"
          fillHeight
          statusMessage={statusMessage}
        />
      </div>
    </div>
  );
}

function resolveProvisioningStatusMessage(status: string | undefined): string {
  if (status === "error") {
    return "Provisioning failed";
  }
  if (status === "pending") {
    return "Preparing agent session";
  }
  if (status === "spawning") {
    return "Provisioning workspace and services";
  }

  return "Waiting for provisioning status update";
}
