import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServiceStream } from "@/hooks/use-service-stream";
import { type CellServiceSummary, cellQueries } from "@/queries/cells";

const BROWSER_REACHABILITY_TIMEOUT_MS = 3000;

type ViewportPreset = "mobile" | "tablet" | "desktop";

const viewportOptions: Array<{ id: ViewportPreset; label: string }> = [
  { id: "mobile", label: "Mobile" },
  { id: "tablet", label: "Tablet" },
  { id: "desktop", label: "Laptop" },
];

export const Route = createFileRoute("/cells/$cellId/viewer")({
  component: CellServiceViewer,
});

function CellServiceViewer() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const isArchived = cellQuery.data?.status === "archived";
  const { services, isLoading, error } = useServiceStream(cellId, {
    enabled: !isArchived,
  });
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!services.length) {
      setSelectedServiceId(null);
      return;
    }
    if (
      selectedServiceId &&
      services.some((service) => service.id === selectedServiceId)
    ) {
      return;
    }
    const fallback =
      services.find(
        (service) =>
          service.port != null && service.status.toLowerCase() === "running"
      ) ??
      services.find((service) => service.port != null) ??
      null;
    setSelectedServiceId(fallback?.id ?? null);
  }, [services, selectedServiceId]);

  const selectedService = services.find(
    (service) => service.id === selectedServiceId
  );

  const viewerUrl = useMemo(() => {
    if (!selectedService?.port) {
      return null;
    }
    return buildViewerUrl(selectedService.port);
  }, [selectedService?.port]);

  const [browserReachability, setBrowserReachability] = useState<
    boolean | null
  >(null);
  const [viewportPreset, setViewportPreset] =
    useState<ViewportPreset>("desktop");

  useEffect(() => {
    setBrowserReachability(null);
    if (!viewerUrl || selectedService?.status.toLowerCase() !== "running") {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      BROWSER_REACHABILITY_TIMEOUT_MS
    );

    fetch(viewerUrl, {
      method: "HEAD",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => setBrowserReachability(true))
      .catch(() => setBrowserReachability(false))
      .finally(() => {
        window.clearTimeout(timeout);
      });

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [selectedService?.status, viewerUrl]);

  const resolvedReachability =
    browserReachability ?? selectedService?.portReachable ?? null;

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
        Archived cells cannot expose live previews. Restore the branch to reopen
        the workspace.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full w-full flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.3em]">
              Service Viewer
            </p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
              Render running service frontends inline with full height.
            </p>
          </div>
          <Select
            disabled={!services.some((service) => service.port != null)}
            onValueChange={setSelectedServiceId}
            value={selectedService?.id ?? ""}
          >
            <SelectTrigger className="w-[260px] border-border bg-background text-foreground">
              <SelectValue placeholder="Select service" />
            </SelectTrigger>
            <SelectContent className="border-border bg-card text-foreground">
              {services
                .filter((service) => service.port != null)
                .map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold text-[12px] text-foreground uppercase tracking-[0.2em]">
                        {service.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Port {service.port}
                      </span>
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </header>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
          <span>
            Target ·{selectedService?.port ? viewerUrl : " No port available"}
          </span>
          {selectedService ? (
            <ServiceStatusBadge status={selectedService.status} />
          ) : null}
          {selectedService?.port ? (
            <span>Port · {selectedService.port}</span>
          ) : null}
          {selectedService ? (
            <span>
              Reachability · {describeReachability(resolvedReachability)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 rounded-sm border border-border bg-background/70 px-3 py-2 text-foreground text-sm">
          <span className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
            URL
          </span>
          <span className="break-all font-mono text-foreground text-xs">
            {viewerUrl ?? "Not available"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!isServiceViewable(selectedService)}
            onClick={() =>
              viewerUrl &&
              window.open(viewerUrl, "_blank", "noopener,noreferrer")
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            Open in new tab
          </Button>
          {resolvedReachability === false ? (
            <span className="text-destructive text-xs uppercase tracking-[0.2em]">
              Browser could not reach the service; verify networking
            </span>
          ) : null}
          {error ? (
            <span className="text-destructive text-xs uppercase tracking-[0.2em]">
              {error}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
            Viewport
          </span>
          {viewportOptions.map((option) => (
            <Button
              key={option.id}
              onClick={() => setViewportPreset(option.id)}
              size="sm"
              type="button"
              variant={option.id === viewportPreset ? "secondary" : "outline"}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-background">
          <ServiceViewerFrame
            isLoading={isLoading}
            selectedService={selectedService ?? null}
            viewerUrl={viewerUrl}
            viewportPreset={viewportPreset}
          />
        </div>
      </div>
    </div>
  );
}

function ServiceViewerFrame({
  selectedService,
  isLoading,
  viewerUrl,
  viewportPreset,
}: {
  selectedService: CellServiceSummary | null;
  isLoading: boolean;
  viewerUrl: string | null;
  viewportPreset: ViewportPreset;
}) {
  if (isLoading) {
    return <ViewerMessage>Loading services…</ViewerMessage>;
  }

  if (!selectedService) {
    return (
      <ViewerMessage>
        Select a service that exposes a port to render its UI.
      </ViewerMessage>
    );
  }

  if (!selectedService.port) {
    return <ViewerMessage>This service does not expose a port.</ViewerMessage>;
  }

  const normalizedStatus = selectedService.status.toLowerCase();
  if (normalizedStatus !== "running") {
    return (
      <ViewerMessage>Start the service to load its preview.</ViewerMessage>
    );
  }

  if (!viewerUrl) {
    return <ViewerMessage>Unable to build a preview URL.</ViewerMessage>;
  }

  const viewportStyle = resolveViewportStyle(viewportPreset);
  const frameStyle =
    viewportPreset === "desktop"
      ? { width: "100%", height: "100%" }
      : viewportStyle;

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto px-2">
      <div
        className="overflow-hidden rounded-sm border border-border bg-card shadow-sm"
        style={frameStyle}
      >
        <iframe
          className="h-full w-full border-0 bg-background"
          key={`${selectedService.id}-${viewportPreset}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={viewerUrl}
          title={`Service ${selectedService.name} viewer`}
        />
      </div>
    </div>
  );
}

function ViewerMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
      {children}
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

function resolveViewportStyle(preset: ViewportPreset) {
  if (preset === "desktop") {
    return {
      width: "100%",
      height: "100%",
      maxWidth: "100%",
      maxHeight: "100%",
    } as const;
  }

  if (preset === "tablet") {
    return {
      width: "900px",
      height: "1100px",
      maxWidth: "100%",
      maxHeight: "100%",
    } as const;
  }

  return {
    width: "428px",
    height: "926px",
    maxWidth: "100%",
    maxHeight: "100%",
  } as const;
}

function buildViewerUrl(port: number) {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return `http://localhost:${port}`;
  }

  const hostname =
    typeof window !== "undefined" && window.location.hostname
      ? window.location.hostname
      : "localhost";
  const protocol =
    typeof window !== "undefined" ? window.location.protocol : "http:";
  return `${protocol}//${hostname}:${port}`;
}

function describeReachability(state: boolean | null | undefined) {
  if (state === true) {
    return "Reachable";
  }
  if (state === false) {
    return "Not reachable";
  }
  return "Unknown";
}

function isServiceViewable(service: CellServiceSummary | undefined | null) {
  if (!service?.port) {
    return false;
  }
  return service.status.toLowerCase() === "running";
}
