import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  type ConstructServiceSummary,
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

  const serviceList = servicesQuery.data ?? [];
  let serviceErrorMessage: string | undefined;
  if (servicesQuery.isError) {
    serviceErrorMessage =
      servicesQuery.error instanceof Error
        ? servicesQuery.error.message
        : "Failed to load services";
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-[#1f1f1c] bg-[#060706]">
      <ServicesPanel
        errorMessage={serviceErrorMessage}
        isLoading={servicesQuery.isPending}
        onRefresh={() => servicesQuery.refetch()}
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
}: {
  services: ConstructServiceSummary[];
  isLoading: boolean;
  errorMessage?: string;
  onRefresh: () => void;
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
          <ServiceCard key={service.id} service={service} />
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

function ServiceCard({ service }: { service: ConstructServiceSummary }) {
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
