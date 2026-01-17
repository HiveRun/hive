import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy } from "lucide-react";
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

  const startAllServicesMutation = useMutation({
    mutationFn: cellMutations.startAllServices.mutationFn,
    onError: (mutationError) => {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : "Failed to start services";
      toast.error(message || "Failed to start services");
    },
  });

  const stopAllServicesMutation = useMutation({
    mutationFn: cellMutations.stopAllServices.mutationFn,
    onSuccess: () => {
      toast.success("Stopped all services");
    },
    onError: (mutationError) => {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : "Failed to stop services";
      toast.error(message || "Failed to stop services");
    },
  });

  const pendingStartId = startServiceMutation.isPending
    ? startServiceMutation.variables?.serviceId
    : undefined;
  const pendingStopId = stopServiceMutation.isPending
    ? stopServiceMutation.variables?.serviceId
    : undefined;
  const isBulkActionPending =
    startAllServicesMutation.isPending || stopAllServicesMutation.isPending;

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

  const handleStartAll = () => {
    startAllServicesMutation.mutate({ cellId });
  };

  const handleStopAll = () => {
    stopAllServicesMutation.mutate({ cellId });
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <ServicesPanel
        errorMessage={streamError}
        isBulkActionPending={isBulkActionPending}
        isLoading={isLoading}
        isStartingAll={startAllServicesMutation.isPending}
        isStoppingAll={stopAllServicesMutation.isPending}
        onStartAll={handleStartAll}
        onStartService={handleStart}
        onStopAll={handleStopAll}
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
  isBulkActionPending,
  isStartingAll,
  isStoppingAll,
  onStartAll,
  onStartService,
  onStopAll,
  onStopService,
  pendingStartId,
  pendingStopId,
}: {
  services: CellServiceSummary[];
  isLoading: boolean;
  errorMessage?: string;
  isBulkActionPending: boolean;
  isStartingAll: boolean;
  isStoppingAll: boolean;
  onStartAll: () => void;
  onStartService: (service: CellServiceSummary) => void;
  onStopAll: () => void;
  onStopService: (service: CellServiceSummary) => void;
  pendingStartId?: string;
  pendingStopId?: string;
}) {
  let body: ReactNode;

  const hasServices = services.length > 0;
  const hasStartableServices = services.some((service) => {
    const normalized = service.status.toLowerCase();
    return (
      normalized !== "running" &&
      normalized !== "starting" &&
      normalized !== "pending"
    );
  });
  const hasStoppableServices = services.some((service) => {
    const normalized = service.status.toLowerCase();
    return normalized === "running";
  });

  const disableStartAll =
    isLoading || Boolean(errorMessage) || !hasServices || !hasStartableServices;
  const disableStopAll =
    isLoading || Boolean(errorMessage) || !hasServices || !hasStoppableServices;

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
            isBulkActionPending={isBulkActionPending}
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-foreground text-lg uppercase tracking-[0.2em]">
            Services
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={disableStartAll || isBulkActionPending}
            onClick={onStartAll}
            size="sm"
            type="button"
            variant="secondary"
          >
            {isStartingAll ? "Starting..." : "Start all"}
          </Button>
          <Button
            disabled={disableStopAll || isBulkActionPending}
            onClick={onStopAll}
            size="sm"
            type="button"
            variant="destructive"
          >
            {isStoppingAll ? "Stopping..." : "Stop all"}
          </Button>
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
  isBulkActionPending,
  isStarting,
  isStopping,
}: {
  service: CellServiceSummary;
  onStart: (service: CellServiceSummary) => void;
  onStop: (service: CellServiceSummary) => void;
  isBulkActionPending: boolean;
  isStarting: boolean;
  isStopping: boolean;
}) {
  const normalizedStatus = service.status.toLowerCase();
  const isErrorState = normalizedStatus === "error";

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (_error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-3 border border-border bg-card p-4",
        isErrorState
          ? "border-destructive shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-destructive)_35%,transparent)]"
          : "border-border/60"
      )}
      style={{ containerType: "inline-size" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-base text-foreground uppercase tracking-[0.15em]">
              {service.name}
            </p>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-xs">
                  {service.command}
                </p>
                <Button
                  aria-label="Copy command"
                  className="h-4 w-4 shrink-0 p-0"
                  onClick={() => service.command && handleCopy(service.command)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Copy className="h-2.5 w-2.5" />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-xs">
                  {service.cwd}
                </p>
                <Button
                  aria-label="Copy directory"
                  className="h-4 w-4 shrink-0 p-0"
                  onClick={() => service.cwd && handleCopy(service.cwd)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Copy className="h-2.5 w-2.5" />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex min-h-[1.75rem] items-center">
            <ServiceStatusBadge status={service.status} />
          </div>
        </div>
        <ServiceActions
          isBulkActionPending={isBulkActionPending}
          isStarting={isStarting}
          isStopping={isStopping}
          onStart={onStart}
          onStop={onStop}
          service={service}
        />
      </div>
      <div className="grid gap-2 text-[11px] uppercase tracking-[0.3em] lg:grid-cols-2">
        <div className="space-y-1">
          <p className="text-muted-foreground">Type</p>
          <p className="font-medium text-foreground">{service.type}</p>
        </div>
        {service.port ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">Port</p>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">
                {service.port}
              </p>
              <Button
                aria-label="Copy port"
                className="h-5 w-5 shrink-0 p-0"
                onClick={() => handleCopy(String(service.port))}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-muted-foreground">Port</p>
            <p className="font-medium text-muted-foreground">—</p>
          </div>
        )}
        {service.pid ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">PID</p>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">
                {service.pid}
              </p>
              <Button
                aria-label="Copy PID"
                className="h-5 w-5 shrink-0 p-0"
                onClick={() => handleCopy(String(service.pid))}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-muted-foreground">PID</p>
            <p className="font-medium text-muted-foreground">—</p>
          </div>
        )}
        {service.logPath ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">Log Path</p>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">
                {service.logPath}
              </p>
              <Button
                aria-label="Copy log path"
                className="h-5 w-5 shrink-0 p-0"
                onClick={() => service.logPath && handleCopy(service.logPath)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-muted-foreground">Log Path</p>
            <p className="font-medium text-muted-foreground">—</p>
          </div>
        )}
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
          Logs
        </p>
        <div
          className="min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-card"
          style={{ maxHeight: "100cqw" }}
        >
          <pre className="h-full min-h-0 overflow-auto whitespace-pre-wrap p-3 text-[11px] text-foreground leading-relaxed">
            {service.recentLogs && service.recentLogs.length > 0
              ? service.recentLogs
              : "No log output yet."}
          </pre>
        </div>
      </div>
    </div>
  );
}

function ServiceActions({
  service,
  onStart,
  onStop,
  isBulkActionPending,
  isStarting,
  isStopping,
}: {
  service: CellServiceSummary;
  onStart: (service: CellServiceSummary) => void;
  onStop: (service: CellServiceSummary) => void;
  isBulkActionPending: boolean;
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
          disabled={isStopping || isBulkActionPending}
          onClick={() => onStop(service)}
          size="sm"
          type="button"
          variant="destructive"
        >
          {isStopping ? "Stopping..." : "Stop"}
        </Button>
      ) : (
        <Button
          disabled={isStarting || isTransitional || isBulkActionPending}
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
