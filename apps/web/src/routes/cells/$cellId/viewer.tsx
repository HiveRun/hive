import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewViewportControls,
} from "@/components/ai-elements/web-preview";
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

const viewportOptions = [
  { id: "mobile", label: "Mobile" },
  { id: "tablet", label: "Tablet" },
  { id: "desktop", label: "Laptop" },
] as const;

export const Route = createFileRoute("/cells/$cellId/viewer")({
  component: CellServiceViewer,
});

function CellServiceViewer() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery(cellQueries.detail(cellId));

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

  return <CellServiceViewerLive cellId={cellId} />;
}

function useServiceSelection(services: CellServiceSummary[]) {
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

  return {
    selectedService,
    selectedServiceId,
    setSelectedServiceId,
  };
}

function useBrowserReachability({
  viewerUrl,
  serviceStatus,
}: {
  viewerUrl: string | null;
  serviceStatus: string | undefined;
}) {
  const [browserReachability, setBrowserReachability] = useState<
    boolean | null
  >(null);

  useEffect(() => {
    setBrowserReachability(null);

    if (!viewerUrl || serviceStatus?.toLowerCase() !== "running") {
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
  }, [serviceStatus, viewerUrl]);

  return browserReachability;
}

function createViewerActions({
  iframeRef,
  viewerUrl,
}: {
  iframeRef: { current: HTMLIFrameElement | null };
  viewerUrl: string | null;
}) {
  const handleRefresh = () => {
    if (iframeRef.current && viewerUrl) {
      iframeRef.current.src = viewerUrl;
    }
  };

  const handleBack = () => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.history?.back();
    }
  };

  const handleForward = () => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.history?.forward();
    }
  };

  const handleOpenInNewTab = () => {
    if (viewerUrl) {
      window.open(viewerUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleMaximize = () => {
    if (iframeRef.current) {
      iframeRef.current.requestFullscreen?.();
    }
  };

  return {
    handleBack,
    handleForward,
    handleMaximize,
    handleOpenInNewTab,
    handleRefresh,
  };
}

function CellServiceViewerLive({ cellId }: { cellId: string }) {
  const { services, isLoading, error } = useServiceStream(cellId, {
    enabled: true,
  });

  const { selectedService, selectedServiceId, setSelectedServiceId } =
    useServiceSelection(services);

  const portServices = services.filter((service) => service.port != null);

  const viewerUrl = selectedService?.url ?? null;

  const browserReachability = useBrowserReachability({
    viewerUrl,
    serviceStatus: selectedService?.status,
  });

  const resolvedReachability =
    browserReachability ?? selectedService?.portReachable ?? null;

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const {
    handleBack,
    handleForward,
    handleMaximize,
    handleOpenInNewTab,
    handleRefresh,
  } = createViewerActions({ iframeRef, viewerUrl });

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full w-full flex-col gap-4 p-4">
        <WebPreview
          error={error ?? undefined}
          isLoading={isLoading}
          url={viewerUrl}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border-2 border-border bg-card p-2">
            <div className="flex flex-wrap items-center gap-2">
              <WebPreviewNavigationButton
                disabled={!viewerUrl}
                onClick={handleBack}
                tooltip="Back"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </WebPreviewNavigationButton>
              <WebPreviewNavigationButton
                disabled={!viewerUrl}
                onClick={handleForward}
                tooltip="Forward"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </WebPreviewNavigationButton>
              <WebPreviewNavigationButton
                disabled={!viewerUrl}
                onClick={handleRefresh}
                tooltip="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </WebPreviewNavigationButton>
              <WebPreviewUrl />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <WebPreviewViewportControls options={viewportOptions} />

              <div className="flex flex-wrap items-center gap-2">
                <WebPreviewNavigationButton
                  disabled={!viewerUrl}
                  onClick={handleOpenInNewTab}
                  tooltip="Open in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled={!viewerUrl}
                  onClick={handleMaximize}
                  tooltip="Fullscreen"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
              </div>

              <div className="flex flex-col gap-1">
                <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                  Service
                </span>
                <Select
                  disabled={portServices.length === 0}
                  onValueChange={setSelectedServiceId}
                  value={selectedServiceId ?? ""}
                >
                  <SelectTrigger className="w-[180px] border-border bg-background text-foreground">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card text-foreground">
                    {portServices.map((service) => (
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
              </div>

              <ReachabilityWarning
                error={error}
                resolvedReachability={resolvedReachability}
              />
            </div>
          </div>

          <WebPreviewBody
            iframeProps={{
              ref: iframeRef,
              title: selectedService
                ? `Service ${selectedService.name} viewer`
                : "Web preview",
            }}
          />
        </WebPreview>
      </div>
    </div>
  );
}

function ReachabilityWarning({
  resolvedReachability,
  error,
}: {
  resolvedReachability: boolean | null;
  error: string | undefined;
}) {
  if (resolvedReachability !== false && !error) {
    return null;
  }

  return (
    <span className="text-destructive text-xs uppercase tracking-[0.2em]">
      {resolvedReachability === false
        ? "Browser could not reach the service; verify networking"
        : error}
    </span>
  );
}
