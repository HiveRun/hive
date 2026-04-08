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
  const elementRect = element.getBoundingClientRect();
  const rect =
    elementRect.width > 0 && elementRect.height > 0
      ? elementRect
      : (element.parentElement?.getBoundingClientRect() ?? elementRect);

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
    if (!element) {
      return;
    }

    const hideViewer = () => {
      viewer.setBounds({ height: 0, width: 0, x: 0, y: 0 }).catch(() => {
        /* ignore hide failures during teardown */
      });
    };

    if (!options.enabled) {
      hideViewer();
      return;
    }

    let frameHandle = 0;

    const sendBounds = () => {
      frameHandle = 0;
      viewer.setBounds(readBounds(element)).catch(() => {
        /* ignore transient layout sync failures */
      });
    };

    const scheduleBoundsSync = () => {
      if (frameHandle !== 0) {
        return;
      }

      frameHandle = window.requestAnimationFrame(sendBounds);
    };

    sendBounds();

    const observer = new ResizeObserver(scheduleBoundsSync);
    observer.observe(element);
    window.addEventListener("resize", scheduleBoundsSync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsSync);
      if (frameHandle !== 0) {
        window.cancelAnimationFrame(frameHandle);
      }
      hideViewer();
    };
  }, [containerRef, options.enabled, viewer]);

  useEffect(() => {
    if (!(viewer && options.enabled && options.url)) {
      lastRequestedUrlRef.current = null;
      return;
    }

    if (lastRequestedUrlRef.current === options.url) {
      return;
    }

    lastRequestedUrlRef.current = options.url;
    viewer
      .navigate(options.url)
      .then(() => {
        const element = containerRef.current;
        if (!element) {
          return;
        }

        viewer.setBounds(readBounds(element)).catch(() => {
          /* ignore post-navigation bounds sync failures */
        });
      })
      .catch(() => {
        /* ignore navigation failures; viewer state will surface them */
      });
  }, [containerRef, options.enabled, options.url, viewer]);

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
