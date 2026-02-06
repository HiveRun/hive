import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LogTerminal } from "@/components/log-terminal";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const {
    services,
    isLoading,
    error: streamError,
  } = useServiceStream(cellId, {
    enabled: true,
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
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");

  useEffect(() => {
    const first = services[0]?.id;
    if (!first) {
      return;
    }

    const selectionExists = services.some(
      (service) => service.id === selectedServiceId
    );
    if (!(selectedServiceId && selectionExists)) {
      setSelectedServiceId(first);
    }
  }, [selectedServiceId, services]);

  const selectedService = services.find((s) => s.id === selectedServiceId);
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
      <div className="flex h-full min-h-0 flex-col">
        {selectedService && (
          <ServiceCard
            isBulkActionPending={isBulkActionPending}
            isStarting={pendingStartId === selectedService.id}
            isStopping={pendingStopId === selectedService.id}
            onStart={onStartService}
            onStop={onStopService}
            service={selectedService}
          />
        )}
      </div>
    );
  }

  return (
    <section className="flex h-full w-full flex-col px-4 py-3 text-muted-foreground text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {hasServices && (
          <Select
            onValueChange={setSelectedServiceId}
            value={selectedServiceId}
          >
            <SelectTrigger className="h-8 w-fit">
              <SelectValue placeholder="Select a service" />
            </SelectTrigger>
            <SelectContent>
              {services.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  <div className="flex flex-col">
                    <span>{service.name}</span>
                    {service.port && (
                      <span className="text-muted-foreground text-xs">
                        Port: {service.port}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
      <div className="min-h-0 flex-1 pb-2">{body}</div>
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
  const [clearedSnapshot, setClearedSnapshot] = useState<string | null>(null);
  const logsSnapshot = service.recentLogs ?? "";

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (_error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  const displayedLogs = logsSnapshot === clearedSnapshot ? "" : logsSnapshot;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden border border-border bg-card p-4",
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

      <div className="grid gap-2.5 border border-border/70 bg-muted/10 p-3 text-xs">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Type
          </p>
          <p className="font-medium text-foreground">{service.type || "—"}</p>

          {service.command && (
            <>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  Command
                </p>
                <Button
                  aria-label="Copy command"
                  className="h-5 w-5 shrink-0 p-0"
                  onClick={() => handleCopy(service.command)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
                {service.command}
              </pre>
            </>
          )}

          {service.cwd && (
            <>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  Working directory
                </p>
                <Button
                  aria-label="Copy working directory"
                  className="h-5 w-5 shrink-0 p-0"
                  onClick={() => handleCopy(service.cwd)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
                {service.cwd}
              </pre>
            </>
          )}

          {service.port ? (
            <>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  Port
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
              <p className="break-all font-mono text-[11px] text-foreground">
                {service.port}
              </p>
            </>
          ) : null}

          {service.pid ? (
            <>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  PID
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
              <p className="break-all font-mono text-[11px] text-foreground">
                {service.pid}
              </p>
            </>
          ) : null}

          {service.logPath ? (
            <>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  Log path
                </p>
                <Button
                  aria-label="Copy log path"
                  className="h-5 w-5 shrink-0 p-0"
                  onClick={() => handleCopy(service.logPath ?? "")}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
                {service.logPath}
              </pre>
            </>
          ) : null}
        </div>
      </div>
      {isErrorState ? null : (
        <div className="min-h-[1.25rem] text-destructive text-xs">
          {service.lastKnownError
            ? `Last error: ${service.lastKnownError}`
            : " "}
        </div>
      )}
      <LogTerminal
        autoScroll
        onClear={() => setClearedSnapshot(logsSnapshot)}
        output={displayedLogs || "No log output yet."}
        title="Logs"
      />
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
