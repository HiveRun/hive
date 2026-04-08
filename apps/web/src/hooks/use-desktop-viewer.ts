import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

type DesktopViewerState = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

type DesktopViewerActions = {
  goBack: () => Promise<DesktopViewerState>;
  goForward: () => Promise<DesktopViewerState>;
  hide: () => Promise<DesktopViewerState>;
  openExternal: () => Promise<{ ok: boolean }>;
  reload: () => Promise<DesktopViewerState>;
};

type UseDesktopViewerOptions = {
  enabled: boolean;
  url: string | null;
};

const EMPTY_VIEWER_STATE: DesktopViewerState = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  isVisible: false,
  title: "",
  url: null,
};

function getDesktopBridge() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.hiveDesktop ?? null;
}

function readBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    height: Math.round(rect.height),
    width: Math.round(rect.width),
    x: Math.round(rect.left),
    y: Math.round(rect.top),
  };
}

export function useDesktopViewer(
  containerRef: RefObject<HTMLElement | null>,
  options: UseDesktopViewerOptions
) {
  const desktop = getDesktopBridge();
  const viewer = desktop?.viewer;
  const isSupported = Boolean(viewer);
  const [state, setState] = useState<DesktopViewerState>(EMPTY_VIEWER_STATE);
  const lastRequestedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!viewer) {
      setState(EMPTY_VIEWER_STATE);
      return;
    }

    let cancelled = false;
    const unsubscribe = viewer.subscribe((nextState: DesktopViewerState) => {
      if (!cancelled) {
        setState(nextState);
      }
    });

    viewer
      .getState()
      .then((nextState: DesktopViewerState) => {
        if (!cancelled) {
          setState(nextState);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState(EMPTY_VIEWER_STATE);
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [viewer]);

  useEffect(() => {
    if (!viewer) {
      return;
    }

    const element = containerRef.current;
    if (!(options.enabled && options.url && element)) {
      lastRequestedUrlRef.current = null;
      viewer.hide().catch(() => {
        /* ignore hide failures during teardown */
      });
      return;
    }

    let frameHandle = 0;
    const syncBounds = () => {
      frameHandle = 0;
      viewer.show(readBounds(element)).catch(() => {
        /* ignore transient layout sync failures */
      });
    };

    const scheduleBoundsSync = () => {
      if (frameHandle !== 0) {
        return;
      }

      frameHandle = window.requestAnimationFrame(syncBounds);
    };

    const observer = new ResizeObserver(scheduleBoundsSync);
    observer.observe(element);
    window.addEventListener("resize", scheduleBoundsSync);
    window.addEventListener("scroll", scheduleBoundsSync, true);
    scheduleBoundsSync();

    if (lastRequestedUrlRef.current !== options.url) {
      lastRequestedUrlRef.current = options.url;
      viewer.navigate(options.url).catch(() => {
        /* ignore navigation failures; viewer state will surface them */
      });
    }

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsSync);
      window.removeEventListener("scroll", scheduleBoundsSync, true);
      if (frameHandle !== 0) {
        window.cancelAnimationFrame(frameHandle);
      }
    };
  }, [containerRef, options.enabled, options.url, viewer]);

  useEffect(() => {
    if (!(viewer && options.enabled)) {
      return;
    }

    return () => {
      lastRequestedUrlRef.current = null;
      viewer.hide().catch(() => {
        /* ignore hide failures during teardown */
      });
    };
  }, [options.enabled, viewer]);

  const actions = useMemo<DesktopViewerActions | null>(() => {
    if (!viewer) {
      return null;
    }

    return {
      goBack: () => viewer.goBack(),
      goForward: () => viewer.goForward(),
      hide: () => viewer.hide(),
      openExternal: () => viewer.openExternal(),
      reload: () => viewer.reload(),
    };
  }, [viewer]);

  return {
    actions,
    isSupported,
    state,
  };
}
