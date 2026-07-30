import { type RefObject, useEffect, useState } from "react";

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

function getDesktopViewer() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.hiveDesktop?.viewer ?? null;
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
  const viewer = getDesktopViewer();
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

    let cancelled = false;
    viewer
      .syncServiceTabs(options.serviceTabs)
      .then(() => {
        if (cancelled) {
          return;
        }
        if (options.enabled && options.activeServiceId) {
          return viewer.activateServiceTab(options.activeServiceId);
        }
        return viewer.hide();
      })
      .catch(() => {
        /* ignore viewer sync failures during transient updates */
      });

    return () => {
      cancelled = true;
    };
  }, [options.activeServiceId, options.enabled, options.serviceTabs, viewer]);

  useEffect(() => {
    if (!viewer) {
      return;
    }

    return () => {
      viewer.syncServiceTabs([]).catch(() => {
        /* ignore service release failures during teardown */
      });
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

    let hidden = false;
    const hideViewer = () => {
      hidden = true;
      viewer.hide().catch(() => {
        /* ignore hide failures during teardown */
      });
    };

    if (!(options.enabled && options.activeServiceId)) {
      hideViewer();
      return;
    }

    const activeServiceId = options.activeServiceId;
    let frameHandle = 0;

    const sendBounds = () => {
      frameHandle = 0;
      const bounds = readBounds(element);
      if (bounds.width <= 0 || bounds.height <= 0) {
        hideViewer();
        return;
      }

      const activate = hidden
        ? viewer.activateServiceTab(activeServiceId)
        : Promise.resolve();
      hidden = false;
      activate
        .then(() => viewer.setBounds(bounds))
        .catch(() => {
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

  return {
    actions: viewer,
    isSupported: Boolean(viewer),
    state,
  };
}
