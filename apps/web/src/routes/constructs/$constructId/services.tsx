import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type ConstructServiceSummary,
  constructMutations,
  constructQueries,
} from "@/queries/constructs";

export const Route = createFileRoute("/constructs/$constructId/services")({
  loader: ({ params, context: { queryClient } }) =>
    queryClient.ensureQueryData(constructQueries.services(params.constructId)),
  component: ConstructServices,
});

function ConstructServices() {
  const { constructId } = Route.useParams();
  const servicesQuery = useQuery(constructQueries.services(constructId));
  const queryClient = useQueryClient();

  const serviceList = servicesQuery.data ?? [];
  let serviceErrorMessage: string | undefined;
  if (servicesQuery.isError) {
    serviceErrorMessage =
      servicesQuery.error instanceof Error
        ? servicesQuery.error.message
        : "Failed to load services";
  }

  const invalidateServices = () => {
    queryClient.invalidateQueries({
      queryKey: constructQueries.services(constructId).queryKey,
    });
  };

  const startServiceMutation = useMutation({
    mutationFn: constructMutations.startService.mutationFn,
    onSuccess: (_data, variables) => {
      invalidateServices();
      toast.success(`Started ${variables.serviceName}`);
    },
    onError: (error, variables) => {
      const message =
        error instanceof Error ? error.message : "Failed to start service";
      toast.error(message || `Failed to start ${variables.serviceName}`);
    },
  });

  const stopServiceMutation = useMutation({
    mutationFn: constructMutations.stopService.mutationFn,
    onSuccess: (_data, variables) => {
      invalidateServices();
      toast.success(`Stopped ${variables.serviceName}`);
    },
    onError: (error, variables) => {
      const message =
        error instanceof Error ? error.message : "Failed to stop service";
      toast.error(message || `Failed to stop ${variables.serviceName}`);
    },
  });

  const pendingStartId = startServiceMutation.isPending
    ? startServiceMutation.variables?.serviceId
    : undefined;
  const pendingStopId = stopServiceMutation.isPending
    ? stopServiceMutation.variables?.serviceId
    : undefined;

  const handleStart = (service: ConstructServiceSummary) => {
    startServiceMutation.mutate({
      constructId,
      serviceId: service.id,
      serviceName: service.name,
    });
  };

  const handleStop = (service: ConstructServiceSummary) => {
    stopServiceMutation.mutate({
      constructId,
      serviceId: service.id,
      serviceName: service.name,
    });
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-[#1f1f1c] bg-[#060706]">
      <ServicesPanel
        errorMessage={serviceErrorMessage}
        isLoading={servicesQuery.isPending}
        onRefresh={() => servicesQuery.refetch()}
        onStartService={handleStart}
        onStopService={handleStop}
        pendingStartId={pendingStartId}
        pendingStopId={pendingStopId}
        services={serviceList}
      />
    </div>
  );
}

function ServicesPanel({
  services,
  isLoading,
  errorMessage,
  onRefresh,
  onStartService,
  onStopService,
  pendingStartId,
  pendingStopId,
}: {
  services: ConstructServiceSummary[];
  isLoading: boolean;
  errorMessage?: string;
  onRefresh: () => void;
  onStartService: (service: ConstructServiceSummary) => void;
  onStopService: (service: ConstructServiceSummary) => void;
  pendingStartId?: string;
  pendingStopId?: string;
}) {
  let body: ReactNode;

  if (isLoading) {
    body = <p className="text-[#8e9088] text-xs">Loading services…</p>;
  } else if (errorMessage) {
    body = <p className="text-[#f19b7f] text-xs">{errorMessage}</p>;
  } else if (services.length === 0) {
    body = (
      <p className="text-[#8e9088] text-xs">
        This construct's template does not define any services.
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
    <section className="flex h-full w-full flex-col px-4 py-3 text-[#d7d9cf] text-sm">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-[#f0f2e9] text-lg uppercase tracking-[0.2em]">
            Services
          </h2>
          <p className="text-[#7b7e76] text-xs uppercase tracking-[0.3em]">
            Runtime status per construct
          </p>
        </div>
        <button
          className="rounded-sm border border-[#2b2f28] px-3 py-1 text-[#b1b3ab] text-[11px] uppercase tracking-[0.3em] hover:border-[#3b4036]"
          onClick={onRefresh}
          type="button"
        >
          Refresh
        </button>
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
  service: ConstructServiceSummary;
  onStart: (service: ConstructServiceSummary) => void;
  onStop: (service: ConstructServiceSummary) => void;
  isStarting: boolean;
  isStopping: boolean;
}) {
  const normalizedStatus = service.status.toLowerCase();
  const isErrorState = normalizedStatus === "error";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-3 border bg-[#040404] p-4",
        isErrorState
          ? "border-[#3f0f0f] shadow-[0_0_0_2px_rgba(255,155,155,0.35)]"
          : "border-[#1b1d17]"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#f4f5ed] text-base uppercase tracking-[0.15em]">
            {service.name}
          </p>
          <p className="text-[#77796f] text-xs">
            {service.command} · {service.cwd}
          </p>
        </div>
        <div className="flex min-h-[1.75rem] items-center">
          <ServiceStatusBadge status={service.status} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-[#8b8e84] text-[11px] uppercase tracking-[0.3em]">
        <span>type · {service.type}</span>
        <span>port · {service.port ?? "—"}</span>
        <span>pid · {service.pid ?? "—"}</span>
        <span>log · {service.logPath ?? "—"}</span>
      </div>
      {isErrorState ? null : (
        <div className="min-h-[1.25rem] text-[#d47d76] text-xs">
          {service.lastKnownError
            ? `Last error: ${service.lastKnownError}`
            : " "}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-[#7b7e76] text-[11px] uppercase tracking-[0.3em]">
          Recent logs
        </p>
        <div className="min-h-0 flex-1 rounded-sm border border-[#24271f] bg-[#0b0c09]">
          <pre className="h-full min-h-0 overflow-auto whitespace-pre-wrap p-3 text-[#cfd2c6] text-[11px] leading-relaxed">
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
  service: ConstructServiceSummary;
  onStart: (service: ConstructServiceSummary) => void;
  onStop: (service: ConstructServiceSummary) => void;
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
    running: "bg-[#0b3c1f] text-[#7ef5a3]",
    starting: "bg-[#3a2c09] text-[#f5dd7e]",
    pending: "bg-[#1a1d26] text-[#9fb4ff]",
    error: "bg-[#3f0f0f] text-[#ff9b9b]",
    stopped: "bg-[#232323] text-[#a2a2a2]",
  };
  const tone = toneMap[normalized] ?? "bg-[#1f2220] text-[#dfe2d6]";

  return (
    <span
      className={`rounded-sm px-3 py-1 text-xs uppercase tracking-[0.4em] ${tone}`}
    >
      {status}
    </span>
  );
}
