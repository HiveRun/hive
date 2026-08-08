import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { ProvisioningChecklistPanel } from "@/components/provisioning-checklist-panel";
import { PtyStreamTerminal } from "@/components/pty-stream-terminal";
import { Button } from "@/components/ui/button";
import { useCellStatusStream } from "@/hooks/use-cell-status-stream";
import { useCellTimingStream } from "@/hooks/use-cell-timing-stream";
import { useServiceStream } from "@/hooks/use-service-stream";
import {
  resolveProvisioningStatusMessage,
  shouldPollProvisioningStatus,
  shouldStreamProvisioningTimeline,
} from "@/lib/provisioning-route-state";
import type { CellServiceSummary } from "@/queries/cells";
import { cellMutations, cellQueries } from "@/queries/cells";
import {
  ignoreRoutePromiseRejection,
  prefetchCellDetail,
  useCreateProvisioningChecklist,
} from "../../-shared/cell-route";

const PROVISIONING_POLL_MS = 1500;

export const Route = createFileRoute("/cells/$cellId/provisioning")({
  loader: ({ context: { queryClient }, params }) => {
    prefetchCellDetail(queryClient, params.cellId);
    queryClient
      .prefetchQuery(
        cellQueries.timings(params.cellId, { workflow: "create", limit: 300 })
      )
      .catch(ignoreRoutePromiseRejection);
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
      return shouldPollProvisioningStatus(status)
        ? PROVISIONING_POLL_MS
        : false;
    },
    refetchIntervalInBackground: true,
  });
  const shouldStreamTimeline = shouldStreamProvisioningTimeline({
    hasCell: Boolean(cellQuery.data),
    status: cellQuery.data?.status,
  });
  const timingsQuery = useQuery({
    ...cellQueries.timings(cellId, { workflow: "create", limit: 300 }),
    enabled: Boolean(cellQuery.data),
  });
  const checklist = useCreateProvisioningChecklist({
    cellStatus: cellQuery.data?.status,
    timings: timingsQuery.data,
  });
  const serviceStream = useServiceStream(cellId, {
    enabled: cellQuery.data?.status === "spawning",
  });
  const retryMutation = useMutation({
    mutationFn: cellMutations.retrySetup.mutationFn,
    onSuccess: () => {
      toast.success("Provisioning retry started");
      cellQuery.refetch().then(undefined, ignoreRoutePromiseRejection);
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
    }).then(undefined, ignoreRoutePromiseRejection);
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

  useCellTimingStream(cellId, {
    enabled: shouldStreamTimeline,
    workflow: "create",
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
      <div className="mx-auto grid h-full min-h-0 w-full max-w-5xl grid-rows-[minmax(14rem,0.9fr)_minmax(18rem,1.1fr)] gap-4 overflow-y-auto lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-1 lg:overflow-hidden">
        <ProvisioningChecklistPanel
          checklist={checklist}
          className="mt-0"
          fillHeight
          statusMessage={statusMessage}
        />
        <ProvisioningServiceActivity
          cellId={cellId}
          isLoading={serviceStream.isLoading}
          services={serviceStream.services}
        />
      </div>
    </div>
  );
}

export function ProvisioningServiceActivity({
  cellId,
  isLoading,
  services,
}: {
  cellId: string;
  isLoading: boolean;
  services: CellServiceSummary[];
}) {
  const activeService =
    services.find((service) => service.status === "starting") ??
    services.find((service) => service.processAlive) ??
    services.find((service) => service.status !== "pending");

  if (!activeService) {
    return (
      <div className="flex min-h-0 items-center justify-center border-2 border-border bg-[#050708] p-4 shadow-[2px_2px_0_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3 border border-primary/50 bg-primary/10 px-4 py-3">
          <Loader2 className="size-4 animate-spin text-primary" />
          <div>
            <p className="font-semibold text-[#FFC857] text-[11px] uppercase tracking-[0.2em]">
              Live startup output
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
              {isLoading
                ? "Connecting to service supervisor"
                : "Preparing service process"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-hidden border-2 border-primary/40 bg-[#050708] shadow-[2px_2px_0_rgba(0,0,0,0.6)]">
      <PtyStreamTerminal
        emptyMessage="Waiting for service output."
        resizePath={`/api/cells/${cellId}/services/${activeService.id}/terminal/resize`}
        streamPath={`/api/cells/${cellId}/services/${activeService.id}/terminal/stream`}
        title={`${activeService.name} startup output`}
      />
    </div>
  );
}
