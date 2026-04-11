import { type RefObject, useEffect, useMemo, useState } from "react";

type DesktopViewerState = {
  activeServiceId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

type DesktopViewerActions = {
  activateServiceTab: (serviceId: string) => Promise<DesktopViewerState>;
  goBack: () => Promise<DesktopViewerState>;
  goForward: () => Promise<DesktopViewerState>;
  hide: () => Promise<DesktopViewerState>;
  navigate: (url: string) => Promise<DesktopViewerState>;
  openExternal: () => Promise<{ ok: boolean }>;
  resetActiveTab: () => Promise<DesktopViewerState>;
  reload: () => Promise<DesktopViewerState>;
};

type DesktopViewerServiceTab = {
  serviceId: string;
  rootUrl: string;
};

type UseDesktopViewerOptions = {
  activeServiceId: string | null;
  enabled: boolean;
  serviceTabs: DesktopViewerServiceTab[];
};

const EMPTY_VIEWER_STATE: DesktopViewerState = {
  activeServiceId: null,
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

    viewer.syncServiceTabs(options.serviceTabs).catch(() => {
      /* ignore service sync failures during transient updates */
    });
  }, [options.serviceTabs, viewer]);

  useEffect(() => {
    if (!viewer) {
      return;
    }

    if (!(options.enabled && options.activeServiceId)) {
      viewer.hide().catch(() => {
        /* ignore hide failures during teardown */
      });
      return;
    }

    viewer.activateServiceTab(options.activeServiceId).catch(() => {
      /* ignore activation failures during rapid service churn */
    });
  }, [options.activeServiceId, options.enabled, viewer]);

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

    if (!(options.enabled && options.activeServiceId)) {
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
    window.addEventListener("scroll", scheduleBoundsSync, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsSync);
      window.removeEventListener("scroll", scheduleBoundsSync, true);
      if (frameHandle !== 0) {
        window.cancelAnimationFrame(frameHandle);
      }
      hideViewer();
    };
  }, [containerRef, options.activeServiceId, options.enabled, viewer]);

  const actions = useMemo<DesktopViewerActions | null>(() => {
    if (!viewer) {
      return null;
    }

    return {
      activateServiceTab: (serviceId: string) =>
        viewer.activateServiceTab(serviceId),
      goBack: () => viewer.goBack(),
      goForward: () => viewer.goForward(),
      hide: () => viewer.hide(),
      navigate: (url: string) => viewer.navigate(url),
      openExternal: () => viewer.openExternal(),
      resetActiveTab: () => viewer.resetActiveTab(),
      reload: () => viewer.reload(),
    };
  }, [viewer]);

  return {
    actions,
    isSupported,
    state,
  };
}
