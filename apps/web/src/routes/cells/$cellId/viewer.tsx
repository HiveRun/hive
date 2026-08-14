import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
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
import {
  addPreferredAudioInput,
  isHiveMicrophoneStatusMessage,
  usePreferredAudioInput,
} from "@/lib/audio-input";
import {
  type BrowserViewerAvailability,
  type BrowserViewerTarget,
  resolveBrowserViewerTargets,
  resolveLoopbackHttpViewerUrl,
  resolveViewerAvailability,
} from "@/lib/viewer-url";
import { cellQueries } from "@/queries/cells";
import { CellDetailGate } from "../../-shared/cell-route";

const BROWSER_REACHABILITY_TIMEOUT_MS = 3000;

const viewportOptions = [
  { id: "mobile", label: "Mobile" },
  { id: "tablet", label: "Tablet" },
  { id: "desktop", label: "Laptop" },
] as const;

type DesktopViewer = NonNullable<Window["hiveDesktop"]>["viewer"];

function runForActiveServiceTab(
  viewer: DesktopViewer | null,
  serviceId: string | null,
  callback: (activeViewer: DesktopViewer) => Promise<unknown>
) {
  if (!(viewer && serviceId)) {
    return;
  }

  viewer
    .activateServiceTab(serviceId)
    .then(() => callback(viewer))
    .catch(() => {
      /* ignore transient tab action failures */
    });
}

function navigateViewer(
  viewer: DesktopViewer | null,
  serviceId: string | null,
  enabled: boolean,
  url: string | null
) {
  if (!(enabled && url)) {
    return;
  }

  runForActiveServiceTab(viewer, serviceId, (activeViewer) =>
    activeViewer.navigate(url)
  );
}

function requestViewerFullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => {
    /* ignore fullscreen failures */
  });
}

function resolveDisplayUrl(
  state: DesktopViewerState,
  activeServiceId: string | null,
  fallbackUrl: string | null
) {
  return state.activeServiceId === activeServiceId
    ? (state.url ?? fallbackUrl)
    : fallbackUrl;
}

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

  useEffect(() => {
    if (
      activeServiceId &&
      services.some((service) => service.id === activeServiceId)
    ) {
      return;
    }

    const fallbackId =
      (
        services.find(
          (service) => service.status.toLowerCase() === "running"
        ) ?? services[0]
      )?.id ?? null;
    activeServiceIdRef.current = fallbackId;
    setActiveServiceId(fallbackId);
  }, [activeServiceId, services]);

  const activeService = services.find(
    (service) => service.id === activeServiceId
  );

  return {
    activeService,
    activeServiceId,
    activeServiceIdRef,
    selectService: (serviceId: string) => {
      activeServiceIdRef.current = serviceId;
      setActiveServiceId(serviceId);
    },
  };
}

export function useBrowserReachability({
  viewerUrl,
  serviceStatus,
}: {
  viewerUrl: string | null;
  serviceStatus: string | undefined;
}) {
  const requestUrl =
    viewerUrl && serviceStatus?.toLowerCase() === "running" ? viewerUrl : null;
  const [result, setResult] = useState<{
    reachability: boolean;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!requestUrl) {
      setResult(null);
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

    fetch(requestUrl, {
      method: "GET",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        if (!cancelled) {
          setResult({ reachability: true, url: requestUrl });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ reachability: false, url: requestUrl });
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
  }, [requestUrl]);

  return result?.url === requestUrl ? result.reachability : null;
}

export function useViewerMicrophoneError(
  browserViewerUrl: string | null,
  audioInputEnabled: boolean
) {
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);

  useEffect(() => {
    setMicrophoneError(null);
    if (!(browserViewerUrl && audioInputEnabled)) {
      return;
    }

    const viewerOrigin = new URL(browserViewerUrl).origin;
    const handleMessage = (event: MessageEvent) => {
      const activeViewerWindow = document.querySelector<HTMLIFrameElement>(
        '[data-testid="web-iframe-preview"]'
      )?.contentWindow;
      if (
        event.origin !== viewerOrigin ||
        event.source !== activeViewerWindow ||
        !isHiveMicrophoneStatusMessage(event.data)
      ) {
        return;
      }
      setMicrophoneError(
        event.data.status === "error"
          ? (event.data.message ?? "Microphone forwarding failed.")
          : null
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [audioInputEnabled, browserViewerUrl]);

  return microphoneError;
}

export function resolvePreferredViewerUrl(
  target: BrowserViewerTarget | undefined,
  preferredAudioInput: string | null
) {
  const rootUrl = resolveLoopbackHttpViewerUrl(target?.url ?? null);
  return target?.audioInput
    ? addPreferredAudioInput(rootUrl, preferredAudioInput)
    : rootUrl;
}

function resolveDesktopServiceTabs(
  targets: BrowserViewerTarget[],
  preferredAudioInput: string | null
) {
  return targets.flatMap((target) => {
    const rootUrl = resolvePreferredViewerUrl(target, preferredAudioInput);
    return rootUrl
      ? [{ audioInput: target.audioInput, rootUrl, serviceId: target.id }]
      : [];
  });
}

function CellServiceViewerLive({ cellId }: { cellId: string }) {
  const { services, isLoading, error } = useServiceStream(cellId, {
    enabled: true,
  });

  const viewerTargets = useMemo(
    () => resolveBrowserViewerTargets(services),
    [services]
  );
  const { activeService, activeServiceId, activeServiceIdRef, selectService } =
    useActiveServiceTab(viewerTargets);
  const preferredAudioInput = usePreferredAudioInput();

  const serviceTabs = useMemo(
    () => resolveDesktopServiceTabs(viewerTargets, preferredAudioInput),
    [preferredAudioInput, viewerTargets]
  );

  const previewUrl = activeService?.url ?? null;
  const browserViewerUrl = resolvePreferredViewerUrl(
    activeService,
    preferredAudioInput
  );
  const nativeViewerAvailability = resolveViewerAvailability(activeService);
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

  const browserReachability = useBrowserReachability({
    viewerUrl: isSupported ? null : browserViewerUrl,
    serviceStatus: activeService?.status,
  });
  const resolvedReachability = isSupported
    ? (activeService?.portReachable ?? null)
    : browserReachability;
  const viewerAvailability = resolveViewerAvailability(
    activeService,
    resolvedReachability
  );
  const displayUrl = resolveDisplayUrl(state, activeServiceId, previewUrl);
  const controlsEnabled = Boolean(actions && nativeViewerReady && displayUrl);
  const microphoneError = useViewerMicrophoneError(
    browserViewerUrl,
    activeService?.audioInput ?? false
  );

  const runViewerAction = (
    callback: (viewer: DesktopViewer) => Promise<unknown>
  ) => runForActiveServiceTab(actions, activeServiceIdRef.current, callback);

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
            (!isSupported && viewerAvailability === "checking")
          }
          onUrlChange={(url) =>
            navigateViewer(
              actions,
              activeServiceIdRef.current,
              nativeViewerReady,
              url
            )
          }
          url={displayUrl}
        >
          <div className="flex flex-col gap-3 rounded-sm border-2 border-border bg-card p-3">
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                Services
              </span>
              <ServiceTabs
                activeServiceId={activeServiceId}
                onValueChange={selectService}
                services={viewerTargets}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-border border-t pt-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <WebPreviewNavigationButton
                  disabled={!(controlsEnabled && state.canGoBack)}
                  onClick={() => runViewerAction((viewer) => viewer.goBack())}
                  tooltip="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled={!(controlsEnabled && state.canGoForward)}
                  onClick={() =>
                    runViewerAction((viewer) => viewer.goForward())
                  }
                  tooltip="Forward"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled={!controlsEnabled}
                  onClick={() => runViewerAction((viewer) => viewer.reload())}
                  tooltip="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled={!controlsEnabled}
                  onClick={() =>
                    runViewerAction((viewer) => viewer.resetActiveTab())
                  }
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
                    disabled={!controlsEnabled}
                    onClick={() =>
                      runViewerAction((viewer) => viewer.openExternal())
                    }
                    tooltip="Open externally"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </WebPreviewNavigationButton>
                  <WebPreviewNavigationButton
                    disabled={!controlsEnabled}
                    onClick={requestViewerFullscreen}
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

          <MicrophoneErrorAlert error={microphoneError} />

          <div className="contents">
            <WebPreviewBody
              emptyState={
                <BrowserViewerState availability={viewerAvailability} />
              }
              previewRef={
                isSupported && nativeActiveServiceId
                  ? previewContainerRef
                  : undefined
              }
            >
              <ViewerSurface
                availability={viewerAvailability}
                isNative={Boolean(isSupported && nativeActiveServiceId)}
                target={activeService}
                url={browserViewerUrl}
              />
            </WebPreviewBody>
          </div>
        </WebPreview>
      </div>
    </div>
  );
}

function MicrophoneErrorAlert({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-2 border-destructive bg-destructive/10 p-4 text-destructive"
      data-testid="viewer-microphone-error"
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CircleAlert className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold text-xs uppercase tracking-[0.18em]">
            Microphone unavailable
          </p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
      <Link
        className="border-2 border-destructive px-3 py-2 font-semibold text-xs uppercase tracking-[0.14em] hover:bg-destructive hover:text-destructive-foreground"
        to="/settings"
      >
        Open settings
      </Link>
    </div>
  );
}

function ViewerSurface({
  availability,
  isNative,
  target,
  url,
}: {
  availability: BrowserViewerAvailability;
  isNative: boolean;
  target: BrowserViewerTarget | undefined;
  url: string | null;
}) {
  const title = target
    ? `Service ${target.label} ${target.portName} viewer`
    : "Web preview";

  if (isNative) {
    return (
      <div
        className="h-full min-h-[320px] w-full bg-background"
        data-testid="native-web-preview"
        title={title}
      />
    );
  }

  if (availability === "ready" && url) {
    return (
      <iframe
        allow={target?.audioInput ? "autoplay; microphone" : "autoplay"}
        className="h-full min-h-[320px] w-full border-0 bg-background"
        data-testid="web-iframe-preview"
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts"
        src={url}
        title={title}
      />
    );
  }

  return <BrowserViewerState availability={availability} />;
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
