import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Maximize2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewViewportControls,
} from "@/components/ai-elements/web-preview";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDesktopViewer } from "@/hooks/use-desktop-viewer";
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

function useActiveServiceTab(services: CellServiceSummary[]) {
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);

  useEffect(() => {
    if (!services.length) {
      setActiveServiceId(null);
      return;
    }

    if (
      activeServiceId &&
      services.some((service) => service.id === activeServiceId)
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

    setActiveServiceId(fallback?.id ?? null);
  }, [activeServiceId, services]);

  const activeService = services.find(
    (service) => service.id === activeServiceId
  );

  return {
    activeService,
    activeServiceId,
    setActiveServiceId,
  };
}

function isPreviewableService(
  service: CellServiceSummary
): service is CellServiceSummary & { port: number; url: string } {
  return service.port != null && typeof service.url === "string";
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

function useViewerControls({
  actions,
  activeServiceId,
  activeServiceUrl,
  displayUrl,
  isDesktopRuntime,
  state,
}: {
  actions: ReturnType<typeof useDesktopViewer>["actions"];
  activeServiceId: string | null;
  activeServiceUrl: string | null;
  displayUrl: string | null;
  isDesktopRuntime: boolean;
  state: ReturnType<typeof useDesktopViewer>["state"];
}) {
  const hasViewerUrl = displayUrl !== null;

  const disabledControls = {
    back: isDesktopRuntime && hasViewerUrl ? !state.canGoBack : true,
    forward: isDesktopRuntime && hasViewerUrl ? !state.canGoForward : true,
    maximize: !(isDesktopRuntime && hasViewerUrl),
    openExternal: !(isDesktopRuntime && hasViewerUrl),
    refresh: !(isDesktopRuntime && hasViewerUrl),
    reset: !(isDesktopRuntime && activeServiceUrl),
  };

  const handleRefresh = () => {
    actions?.reload().catch(() => {
      /* ignore refresh failures */
    });
  };

  const handleBack = () => {
    actions?.goBack().catch(() => {
      /* ignore navigation failures */
    });
  };

  const handleForward = () => {
    actions?.goForward().catch(() => {
      /* ignore navigation failures */
    });
  };

  const handleOpenExternal = () => {
    actions?.openExternal().catch(() => {
      /* ignore external open failures */
    });
  };

  const handleMaximize = () => {
    document.documentElement.requestFullscreen?.().catch(() => {
      /* ignore fullscreen failures */
    });
  };

  const handleReset = () => {
    actions?.resetActiveTab().catch(() => {
      /* ignore reset failures */
    });
  };

  const handleNavigate = (url: string | null) => {
    if (!(isDesktopRuntime && url && activeServiceId)) {
      return;
    }

    actions?.navigate(url).catch(() => {
      /* ignore navigation failures */
    });
  };

  return {
    disabledControls,
    handleBack,
    handleForward,
    handleMaximize,
    handleNavigate,
    handleOpenExternal,
    handleRefresh,
    handleReset,
  };
}

function CellServiceViewerLive({ cellId }: { cellId: string }) {
  const { services, isLoading, error } = useServiceStream(cellId, {
    enabled: true,
  });

  const previewableServices = useMemo(
    () => services.filter(isPreviewableService),
    [services]
  );
  const { activeService, activeServiceId, setActiveServiceId } =
    useActiveServiceTab(previewableServices);

  const serviceTabs = useMemo(
    () =>
      previewableServices.map((service) => ({
        rootUrl: service.url,
        serviceId: service.id,
      })),
    [previewableServices]
  );

  const previewUrl = activeService?.url ?? null;

  const browserReachability = useBrowserReachability({
    viewerUrl: previewUrl,
    serviceStatus: activeService?.status,
  });

  const resolvedReachability =
    browserReachability ?? activeService?.portReachable ?? null;
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const { actions, isSupported, state } = useDesktopViewer(
    previewContainerRef,
    {
      activeServiceId,
      enabled: previewableServices.length > 0,
      serviceTabs,
    }
  );

  const isDesktopRuntime = isSupported;

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    return () => {
      actions?.hide().catch(() => {
        /* ignore teardown failures */
      });
    };
  }, [actions, isDesktopRuntime]);

  const displayUrl =
    state.activeServiceId === activeServiceId
      ? (state.url ?? previewUrl)
      : previewUrl;
  const {
    disabledControls,
    handleBack,
    handleForward,
    handleMaximize,
    handleNavigate,
    handleOpenExternal,
    handleRefresh,
    handleReset,
  } = useViewerControls({
    actions,
    activeServiceId,
    activeServiceUrl: activeService?.url ?? null,
    displayUrl,
    isDesktopRuntime,
    state,
  });

  return (
    <div
      className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-border bg-card"
      data-testid="cell-viewer-route"
    >
      <div className="flex h-full w-full flex-col gap-4 p-4">
        <WebPreview
          error={error ?? undefined}
          isLoading={isLoading || state.isLoading}
          onUrlChange={handleNavigate}
          url={displayUrl}
        >
          <div className="flex flex-col gap-3 rounded-sm border-2 border-border bg-card p-3">
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                Services
              </span>
              <ServiceTabs
                activeServiceId={activeServiceId}
                onValueChange={setActiveServiceId}
                services={previewableServices}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-border border-t pt-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <WebPreviewNavigationButton
                  disabled={disabledControls.back}
                  onClick={handleBack}
                  tooltip="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled={disabledControls.forward}
                  onClick={handleForward}
                  tooltip="Forward"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled={disabledControls.refresh}
                  onClick={handleRefresh}
                  tooltip="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled={!activeService?.url}
                  onClick={handleReset}
                  tooltip="Reset to service root"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewUrl className="max-w-none sm:max-w-md" />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <WebPreviewViewportControls options={viewportOptions} />

                <div className="flex flex-wrap items-center gap-2">
                  <WebPreviewNavigationButton
                    disabled={disabledControls.openExternal}
                    onClick={handleOpenExternal}
                    tooltip="Open externally"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </WebPreviewNavigationButton>
                  <WebPreviewNavigationButton
                    disabled={disabledControls.maximize}
                    onClick={handleMaximize}
                    tooltip="Fullscreen"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </WebPreviewNavigationButton>
                </div>
              </div>

              <ReachabilityWarning
                error={error}
                resolvedReachability={resolvedReachability}
              />
            </div>
          </div>

          <div className="contents">
            <WebPreviewBody
              emptyState={
                isDesktopRuntime ? undefined : <DesktopOnlyViewerMessage />
              }
              previewRef={
                isDesktopRuntime && activeServiceId
                  ? previewContainerRef
                  : undefined
              }
            >
              {isDesktopRuntime && activeServiceId ? (
                <div
                  className="h-full min-h-[320px] w-full bg-background"
                  data-testid="native-web-preview"
                  title={
                    activeService
                      ? `Service ${activeService.name} viewer`
                      : "Web preview"
                  }
                />
              ) : (
                <DesktopOnlyViewerMessage />
              )}
            </WebPreviewBody>
          </div>
        </WebPreview>
      </div>
    </div>
  );
}

function ServiceTabs({
  activeServiceId,
  onValueChange,
  services,
}: {
  activeServiceId: string | null;
  onValueChange: (value: string) => void;
  services: CellServiceSummary[];
}) {
  return (
    <Tabs onValueChange={onValueChange} value={activeServiceId ?? undefined}>
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-sm border border-border bg-background p-1">
        {services.map((service) => (
          <TabsTrigger
            className="min-w-[118px] flex-col items-start gap-0 rounded-sm border-border/60 px-3 py-2 text-left data-[state=active]:border-border data-[state=active]:bg-card"
            data-testid={`viewer-service-tab-${service.name}`}
            key={service.id}
            value={service.id}
          >
            <span className="font-semibold text-[12px] text-foreground uppercase tracking-[0.2em]">
              {service.name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Port {service.port}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function DesktopOnlyViewerMessage() {
  return (
    <div
      className="flex h-full min-h-[320px] w-full items-center justify-center bg-background px-6 text-center"
      data-testid="viewer-desktop-only-message"
    >
      <div className="flex max-w-md flex-col gap-3 text-muted-foreground text-sm">
        <p className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
          Hive Desktop required
        </p>
        <p>
          Browser preview now uses Electron directly. Open this cell in Hive
          Desktop to inspect services without iframe focus and history quirks.
        </p>
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
