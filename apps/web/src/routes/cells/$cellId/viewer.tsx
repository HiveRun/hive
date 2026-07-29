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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  type BrowserViewerAvailability,
  type BrowserViewerTarget,
  resolveBrowserViewerAvailability,
  resolveBrowserViewerTargets,
  resolveLoopbackHttpViewerUrl,
  resolveNativeViewerAvailability,
} from "@/lib/viewer-url";
import { cellQueries } from "@/queries/cells";
import { CellDetailGate } from "../../-shared/cell-route";

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

  return (
    <CellDetailGate errorFallback="Failed to load cell" query={cellQuery}>
      <CellServiceViewerLive cellId={cellId} />
    </CellDetailGate>
  );
}

function useActiveServiceTab(services: BrowserViewerTarget[]) {
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);
  const activeServiceIdRef = useRef<string | null>(null);

  const setActiveServiceIdImmediate = useCallback(
    (nextServiceId: string | null) => {
      activeServiceIdRef.current = nextServiceId;
      setActiveServiceId(nextServiceId);
    },
    []
  );

  useEffect(() => {
    if (!services.length) {
      setActiveServiceIdImmediate(null);
      return;
    }

    if (
      activeServiceId &&
      services.some((service) => service.id === activeServiceId)
    ) {
      return;
    }

    const fallback =
      services.find((service) => service.status.toLowerCase() === "running") ??
      services[0] ??
      null;

    setActiveServiceIdImmediate(fallback?.id ?? null);
  }, [activeServiceId, services, setActiveServiceIdImmediate]);

  const activeService = services.find(
    (service) => service.id === activeServiceId
  );

  return {
    activeService,
    activeServiceId,
    activeServiceIdRef,
    setActiveServiceId: setActiveServiceIdImmediate,
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
    let cancelled = false;
    const timeout = window.setTimeout(
      () => controller.abort(),
      BROWSER_REACHABILITY_TIMEOUT_MS
    );

    fetch(viewerUrl, {
      method: "HEAD",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        if (!cancelled) {
          setBrowserReachability(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrowserReachability(false);
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [serviceStatus, viewerUrl]);

  return browserReachability;
}

function useViewerControls({
  actions,
  activeServiceIdRef,
  activeServiceUrl,
  displayUrl,
  isDesktopRuntime,
  viewerReady,
  state,
}: {
  actions: ReturnType<typeof useDesktopViewer>["actions"];
  activeServiceIdRef: { current: string | null };
  activeServiceUrl: string | null;
  displayUrl: string | null;
  isDesktopRuntime: boolean;
  viewerReady: boolean;
  state: ReturnType<typeof useDesktopViewer>["state"];
}) {
  const hasViewerUrl = displayUrl !== null;

  const runForActiveServiceTab = (
    callback: (serviceId: string) => Promise<unknown>
  ) => {
    const serviceId = activeServiceIdRef.current;
    if (!(actions && serviceId)) {
      return;
    }

    actions
      .activateServiceTab(serviceId)
      .then(() => callback(serviceId))
      .catch(() => {
        /* ignore transient tab action failures */
      });
  };

  const disabledControls = {
    back:
      isDesktopRuntime && viewerReady && hasViewerUrl ? !state.canGoBack : true,
    forward:
      isDesktopRuntime && viewerReady && hasViewerUrl
        ? !state.canGoForward
        : true,
    maximize: !(isDesktopRuntime && viewerReady && hasViewerUrl),
    openExternal: !(isDesktopRuntime && viewerReady && hasViewerUrl),
    refresh: !(isDesktopRuntime && viewerReady && hasViewerUrl),
    reset: !(isDesktopRuntime && viewerReady && activeServiceUrl),
  };

  const handleRefresh = () => {
    runForActiveServiceTab(() => actions?.reload() ?? Promise.resolve());
  };

  const handleBack = () => {
    runForActiveServiceTab(() => actions?.goBack() ?? Promise.resolve());
  };

  const handleForward = () => {
    runForActiveServiceTab(() => actions?.goForward() ?? Promise.resolve());
  };

  const handleOpenExternal = () => {
    runForActiveServiceTab(() => actions?.openExternal() ?? Promise.resolve());
  };

  const handleMaximize = () => {
    document.documentElement.requestFullscreen?.().catch(() => {
      /* ignore fullscreen failures */
    });
  };

  const handleReset = () => {
    runForActiveServiceTab(
      () => actions?.resetActiveTab() ?? Promise.resolve()
    );
  };

  const handleNavigate = (url: string | null) => {
    if (
      !(isDesktopRuntime && viewerReady && url && activeServiceIdRef.current)
    ) {
      return;
    }

    runForActiveServiceTab(() => actions?.navigate(url) ?? Promise.resolve());
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

  const viewerTargets = useMemo(
    () => resolveBrowserViewerTargets(services),
    [services]
  );
  const {
    activeService,
    activeServiceId,
    activeServiceIdRef,
    setActiveServiceId,
  } = useActiveServiceTab(viewerTargets);

  const serviceTabs = useMemo(
    () =>
      viewerTargets.flatMap((target) => {
        const rootUrl = resolveLoopbackHttpViewerUrl(target.url);
        return rootUrl ? [{ rootUrl, serviceId: target.id }] : [];
      }),
    [viewerTargets]
  );

  const previewUrl = activeService?.url ?? null;
  const browserViewerUrl = resolveLoopbackHttpViewerUrl(previewUrl);

  const browserReachability = useBrowserReachability({
    viewerUrl: browserViewerUrl,
    serviceStatus: activeService?.status,
  });
  const nativeViewerAvailability =
    resolveNativeViewerAvailability(activeService);
  const nativeViewerReady = nativeViewerAvailability === "ready";
  const nativeActiveServiceId = nativeViewerReady ? activeServiceId : null;

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const { actions, isSupported, state } = useDesktopViewer(
    previewContainerRef,
    {
      activeServiceId: nativeActiveServiceId,
      enabled: nativeViewerReady,
      serviceTabs,
    }
  );

  const isDesktopRuntime = isSupported;
  const resolvedReachability = isDesktopRuntime
    ? (activeService?.portReachable ?? null)
    : browserReachability;
  const browserViewerAvailability = resolveBrowserViewerAvailability({
    hasService: Boolean(activeService),
    reachability: browserReachability,
    serviceStatus: activeService?.status,
    viewerUrl: previewUrl,
  });
  const viewerAvailability = isDesktopRuntime
    ? nativeViewerAvailability
    : browserViewerAvailability;

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
    activeServiceIdRef,
    activeServiceUrl: activeService?.url ?? null,
    displayUrl,
    isDesktopRuntime,
    viewerReady: nativeViewerReady,
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
          isLoading={
            isLoading ||
            state.isLoading ||
            (!isDesktopRuntime && browserViewerAvailability === "checking")
          }
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
                services={viewerTargets}
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
                  disabled={disabledControls.reset}
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
                <BrowserViewerState availability={viewerAvailability} />
              }
              previewRef={
                isDesktopRuntime && nativeActiveServiceId
                  ? previewContainerRef
                  : undefined
              }
            >
              <ViewerSurface
                activeService={activeService}
                activeServiceId={nativeActiveServiceId}
                browserViewerAvailability={viewerAvailability}
                browserViewerUrl={browserViewerUrl}
                isDesktopRuntime={isDesktopRuntime}
              />
            </WebPreviewBody>
          </div>
        </WebPreview>
      </div>
    </div>
  );
}

function ViewerSurface({
  activeService,
  activeServiceId,
  browserViewerAvailability,
  browserViewerUrl,
  isDesktopRuntime,
}: {
  activeService: BrowserViewerTarget | undefined;
  activeServiceId: string | null;
  browserViewerAvailability: BrowserViewerAvailability;
  browserViewerUrl: string | null;
  isDesktopRuntime: boolean;
}) {
  const title = activeService
    ? `Service ${activeService.label} ${activeService.portName} viewer`
    : "Web preview";

  if (isDesktopRuntime && activeServiceId) {
    return (
      <div
        className="h-full min-h-[320px] w-full bg-background"
        data-testid="native-web-preview"
        title={title}
      />
    );
  }

  if (browserViewerAvailability === "ready" && browserViewerUrl) {
    return (
      <iframe
        allow="microphone"
        className="h-full min-h-[320px] w-full border-0 bg-background"
        data-testid="web-iframe-preview"
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts"
        src={browserViewerUrl}
        title={title}
      />
    );
  }

  return <BrowserViewerState availability={browserViewerAvailability} />;
}

function ServiceTabs({
  activeServiceId,
  onValueChange,
  services,
}: {
  activeServiceId: string | null;
  onValueChange: (value: string) => void;
  services: BrowserViewerTarget[];
}) {
  return (
    <Tabs onValueChange={onValueChange} value={activeServiceId ?? undefined}>
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-sm border border-border bg-background p-1">
        {services.map((service) => (
          <TabsTrigger
            className="min-w-[118px] flex-col items-start gap-0 rounded-sm border-border/60 px-3 py-2 text-left data-[state=active]:border-border data-[state=active]:bg-card"
            data-testid={`viewer-service-tab-${service.testId}`}
            key={service.id}
            value={service.id}
          >
            <span className="font-semibold text-[12px] text-foreground uppercase tracking-[0.2em]">
              {service.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {service.portName} / {service.protocol} / Port {service.port}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function BrowserViewerState({
  availability,
}: {
  availability: BrowserViewerAvailability;
}) {
  const content: Record<
    Exclude<BrowserViewerAvailability, "ready">,
    { message: string; title: string }
  > = {
    checking: {
      title: "Checking service",
      message: "Hive is verifying that this loopback service is reachable.",
    },
    empty: {
      title: "No browser service",
      message: "Start a service with a browser URL to open it in this viewer.",
    },
    "not-running": {
      title: "Service offline",
      message: "Start this service before opening its browser viewer.",
    },
    unreachable: {
      title: "Service unreachable",
      message: "The browser could not connect to this loopback service.",
    },
    unsupported: {
      title: "Preview unavailable",
      message: "Hive only embeds loopback HTTP or HTTPS service URLs.",
    },
  };
  const state =
    availability === "ready" ? content.checking : content[availability];

  return (
    <div
      className="flex h-full min-h-[320px] w-full items-center justify-center bg-background px-6 text-center"
      data-testid={`viewer-${availability}-message`}
    >
      <div className="flex max-w-md flex-col gap-3 text-muted-foreground text-sm">
        <p className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
          {state.title}
        </p>
        <p>{state.message}</p>
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
