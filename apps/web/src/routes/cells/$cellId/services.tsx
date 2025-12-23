import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useServiceStream } from "@/hooks/use-service-stream";
import { cn } from "@/lib/utils";
import {
  type CellServiceSummary,
  cellMutations,
  cellQueries,
} from "@/queries/cells";

export const Route = createFileRoute("/cells/$cellId/services")({
  component: CellServices,
});

function CellServices() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const isArchived = cellQuery.data?.status === "archived";
  const {
    services,
    isLoading,
    error: streamError,
  } = useServiceStream(cellId, {
    enabled: !isArchived,
  });

  const startServiceMutation = useMutation({
    mutationFn: cellMutations.startService.mutationFn,
    onError: (mutationError, variables) => {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : "Failed to start service";
      toast.error(message || `Failed to start ${variables.serviceName}`);
    },
  });

  const stopServiceMutation = useMutation({
    mutationFn: cellMutations.stopService.mutationFn,
    onSuccess: (_data, variables) => {
      toast.success(`Stopped ${variables.serviceName}`);
    },
    onError: (mutationError, variables) => {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : "Failed to stop service";
      toast.error(message || `Failed to stop ${variables.serviceName}`);
    },
  });

  const pendingStartId = startServiceMutation.isPending
    ? startServiceMutation.variables?.serviceId
    : undefined;
  const pendingStopId = stopServiceMutation.isPending
    ? stopServiceMutation.variables?.serviceId
    : undefined;

  if (cellQuery.isLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground">
        Loading cell…
      </div>
    );
  }

  if (cellQuery.error) {
    const message =
      cellQuery.error instanceof Error
        ? cellQuery.error.message
        : "Failed to load cell";
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-destructive/50 bg-destructive/10 text-destructive">
        {message}
      </div>
    );
  }

  if (isArchived) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground">
        Archived cells cannot manage services. Restore the branch to reopen this
        workspace.
      </div>
    );
  }

  const handleStart = (service: CellServiceSummary) => {
    startServiceMutation.mutate({
      cellId,
      serviceId: service.id,
      serviceName: service.name,
    });
  };

  const handleStop = (service: CellServiceSummary) => {
    stopServiceMutation.mutate({
      cellId,
      serviceId: service.id,
      serviceName: service.name,
    });
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <ServicesPanel
        errorMessage={streamError}
        isLoading={isLoading}
        onStartService={handleStart}
        onStopService={handleStop}
        pendingStartId={pendingStartId}
        pendingStopId={pendingStopId}
        services={services}
      />
    </div>
  );
}

function ServicesPanel({
  services,
  isLoading,
  errorMessage,
  onStartService,
  onStopService,
  pendingStartId,
  pendingStopId,
}: {
  services: CellServiceSummary[];
  isLoading: boolean;
  errorMessage?: string;
  onStartService: (service: CellServiceSummary) => void;
  onStopService: (service: CellServiceSummary) => void;
  pendingStartId?: string;
  pendingStopId?: string;
}) {
  let body: ReactNode;

  if (isLoading) {
    body = <p className="text-muted-foreground text-xs">Loading services…</p>;
  } else if (errorMessage) {
    body = <p className="text-destructive text-xs">{errorMessage}</p>;
  } else if (services.length === 0) {
    body = (
      <p className="text-muted-foreground text-xs">
        This cell's template does not define any services.
      </p>
    );
  } else {
    body = (
      <div className="grid h-full min-h-0 auto-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {services.map((service) => (
          <ServiceCard
            isStarting={pendingStartId === service.id}
            isStopping={pendingStopId === service.id}
            key={service.id}
            onStart={onStartService}
            onStop={onStopService}
            service={service}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="flex h-full w-full flex-col px-4 py-3 text-muted-foreground text-sm">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-foreground text-lg uppercase tracking-[0.2em]">
            Services
          </h2>
          <p className="text-muted-foreground text-xs uppercase tracking-[0.3em]">
            Runtime status per cell
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">{body}</div>
    </section>
  );
}

function ServiceCard({
  service,
  onStart,
  onStop,
  isStarting,
  isStopping,
}: {
  service: CellServiceSummary;
  onStart: (service: CellServiceSummary) => void;
  onStop: (service: CellServiceSummary) => void;
  isStarting: boolean;
  isStopping: boolean;
}) {
  const normalizedStatus = service.status.toLowerCase();
  const isErrorState = normalizedStatus === "error";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-3 border border-border bg-card p-4",
        isErrorState
          ? "border-destructive shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-destructive)_35%,transparent)]"
          : "border-border/60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-base text-foreground uppercase tracking-[0.15em]">
            {service.name}
          </p>
          <p className="text-muted-foreground text-xs">
            {service.command} · {service.cwd}
          </p>
        </div>
        <div className="flex min-h-[1.75rem] items-center">
          <ServiceStatusBadge status={service.status} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        <span>type · {service.type}</span>
        <span>port · {service.port ?? "—"}</span>
        <span>pid · {service.pid ?? "—"}</span>
        <span>log · {service.logPath ?? "—"}</span>
      </div>
      {isErrorState ? null : (
        <div className="min-h-[1.25rem] text-destructive text-xs">
          {service.lastKnownError
            ? `Last error: ${service.lastKnownError}`
            : " "}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
          Recent logs
        </p>
        <div className="min-h-0 flex-1 rounded-sm border border-border bg-card">
          <pre className="h-full min-h-0 overflow-auto whitespace-pre-wrap p-3 text-[11px] text-foreground leading-relaxed">
            {service.recentLogs && service.recentLogs.length > 0
              ? service.recentLogs
              : "No log output yet."}
          </pre>
        </div>
      </div>
      <ServiceActions
        isStarting={isStarting}
        isStopping={isStopping}
        onStart={onStart}
        onStop={onStop}
        service={service}
      />
    </div>
  );
}

function ServiceActions({
  service,
  onStart,
  onStop,
  isStarting,
  isStopping,
}: {
  service: CellServiceSummary;
  onStart: (service: CellServiceSummary) => void;
  onStop: (service: CellServiceSummary) => void;
  isStarting: boolean;
  isStopping: boolean;
}) {
  const normalizedStatus = service.status.toLowerCase();
  const isRunning = normalizedStatus === "running";
  const isTransitional =
    normalizedStatus === "starting" || normalizedStatus === "pending";

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {isRunning ? (
        <Button
          disabled={isStopping}
          onClick={() => onStop(service)}
          size="sm"
          type="button"
          variant="destructive"
        >
          {isStopping ? "Stopping..." : "Stop"}
        </Button>
      ) : (
        <Button
          disabled={isStarting || isTransitional}
          onClick={() => onStart(service)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {isStarting ? "Starting..." : "Start"}
        </Button>
      )}
    </div>
  );
}

function ServiceStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const toneMap: Record<string, string> = {
    running: "bg-primary/15 text-primary",
    starting: "bg-secondary/20 text-secondary-foreground",
    pending: "bg-muted text-muted-foreground",
    error: "bg-destructive/10 text-destructive",
    stopped: "bg-border/20 text-muted-foreground",
  };
  const tone = toneMap[normalized] ?? "bg-muted text-muted-foreground";

  return (
    <span
      className={`rounded-sm px-3 py-1 text-xs uppercase tracking-[0.4em] ${tone}`}
    >
      {status}
    </span>
  );
}
