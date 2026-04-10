import {
  BrowserView,
  type BrowserWindow,
  type Rectangle,
  shell,
} from "electron";

export type ViewerBounds = Pick<Rectangle, "x" | "y" | "width" | "height">;

export type ViewerState = {
  activeServiceId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

export type ViewerServiceTab = {
  serviceId: string;
  rootUrl: string;
};

type ViewerEntry = {
  rootUrl: string;
  view: BrowserView;
};

type ViewerController = {
  activateServiceTab: (serviceId: string) => Promise<ViewerState>;
  destroy: () => void;
  getState: () => ViewerState;
  goBack: () => ViewerState;
  goForward: () => ViewerState;
  hide: () => ViewerState;
  loadURL: (url: string) => Promise<ViewerState>;
  openExternal: () => Promise<{ ok: boolean }>;
  resetActiveTab: () => Promise<ViewerState>;
  reload: () => ViewerState;
  setBounds: (bounds: ViewerBounds) => ViewerState;
  show: (bounds: ViewerBounds) => ViewerState;
  syncServiceTabs: (tabs: ViewerServiceTab[]) => Promise<ViewerState>;
};

export const createViewerController = (options: {
  onStateChange: (state: ViewerState) => void;
  window: BrowserWindow;
}): ViewerController => {
  const entries = new Map<string, ViewerEntry>();
  let activeServiceId: string | null = null;
  let attachedServiceId: string | null = null;
  let disposed = false;
  let visible = false;
  let lastBounds: ViewerBounds = { height: 0, width: 0, x: 0, y: 0 };

  const emptyState = (): ViewerState => ({
    activeServiceId,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    isVisible: visible,
    title: "",
    url: null,
  });

  const getState = (): ViewerState => {
    const activeEntry = activeServiceId ? entries.get(activeServiceId) : null;
    const activeView = activeEntry?.view;
    if (!activeView || activeView.webContents.isDestroyed()) {
      return emptyState();
    }

    return {
      activeServiceId,
      canGoBack: activeView.webContents.navigationHistory.canGoBack(),
      canGoForward: activeView.webContents.navigationHistory.canGoForward(),
      isLoading: activeView.webContents.isLoading(),
      isVisible: visible,
      title: activeView.webContents.getTitle(),
      url: activeView.webContents.getURL() || null,
    };
  };

  const emitState = () => {
    const nextState = getState();
    options.onStateChange(nextState);
    return nextState;
  };

  const applyBounds = (bounds: ViewerBounds) => {
    if (disposed) {
      return;
    }

    lastBounds = bounds;
    visible =
      attachedServiceId !== null && bounds.width > 0 && bounds.height > 0;

    const attachedView = attachedServiceId
      ? entries.get(attachedServiceId)?.view
      : null;

    if (!attachedView) {
      return;
    }

    try {
      attachedView.setBounds(bounds);
    } catch {
      /* ignore bounds updates during teardown */
    }
  };

  const detachAttachedView = () => {
    if (!attachedServiceId) {
      return;
    }

    const entry = entries.get(attachedServiceId);
    attachedServiceId = null;
    visible = false;

    if (!entry || options.window.isDestroyed()) {
      return;
    }

    try {
      options.window.removeBrowserView(entry.view);
    } catch {
      /* ignore detach failures while Electron destroys the view */
    }
  };

  const attachServiceView = (serviceId: string) => {
    const entry = entries.get(serviceId);
    if (!entry) {
      return null;
    }

    if (attachedServiceId === serviceId) {
      applyBounds(lastBounds);
      return entry;
    }

    detachAttachedView();
    options.window.addBrowserView(entry.view);
    attachedServiceId = serviceId;
    applyBounds(lastBounds);
    return entry;
  };

  const handleWindowOpen = ({ url }: { url: string }) => {
    shell.openExternal(url).catch(() => {
      /* ignore open failures */
    });

    return { action: "deny" as const };
  };

  const emitStateForService = (serviceId: string) => {
    if (serviceId === activeServiceId) {
      emitState();
    }
  };

  const isNavigationAbortError = (error: unknown) => {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message.includes("ERR_ABORTED") || error.message.includes("-3")
    );
  };

  const loadUrlSafely = async (entry: ViewerEntry, url: string) => {
    try {
      await entry.view.webContents.loadURL(url);
    } catch (error) {
      if (!isNavigationAbortError(error)) {
        throw error;
      }
    }
  };

  const createEntry = (serviceId: string, rootUrl: string) => {
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const entry: ViewerEntry = {
      rootUrl,
      view,
    };

    view.webContents.setWindowOpenHandler(handleWindowOpen);
    view.webContents.on("did-start-loading", () =>
      emitStateForService(serviceId)
    );
    view.webContents.on("did-stop-loading", () =>
      emitStateForService(serviceId)
    );
    view.webContents.on("did-navigate", () => emitStateForService(serviceId));
    view.webContents.on("did-navigate-in-page", () =>
      emitStateForService(serviceId)
    );
    view.webContents.on("page-title-updated", () =>
      emitStateForService(serviceId)
    );
    view.webContents.on("destroyed", () => {
      if (attachedServiceId === serviceId) {
        attachedServiceId = null;
        visible = false;
      }

      entries.delete(serviceId);
      if (activeServiceId === serviceId) {
        activeServiceId = null;
      }

      emitState();
    });

    entries.set(serviceId, entry);
    return entry;
  };

  const loadRootUrlIfNeeded = async (entry: ViewerEntry) => {
    const currentUrl = entry.view.webContents.getURL();
    if (currentUrl) {
      return;
    }

    await loadUrlSafely(entry, entry.rootUrl);
  };

  const getActiveEntry = () =>
    activeServiceId ? (entries.get(activeServiceId) ?? null) : null;

  const syncExistingServiceTabs = async (nextRootUrls: Map<string, string>) => {
    for (const [serviceId, entry] of entries) {
      const nextRootUrl = nextRootUrls.get(serviceId);
      if (!nextRootUrl) {
        closeEntry(serviceId);
        continue;
      }

      const previousRootUrl = entry.rootUrl;
      entry.rootUrl = nextRootUrl;

      if (entry.view.webContents.isDestroyed()) {
        continue;
      }

      const currentUrl = entry.view.webContents.getURL();
      const rootUrlChanged = nextRootUrl !== previousRootUrl;
      if (rootUrlChanged && (!currentUrl || currentUrl === previousRootUrl)) {
        await loadUrlSafely(entry, nextRootUrl);
      }
    }
  };

  const createMissingServiceTabs = (nextRootUrls: Map<string, string>) => {
    for (const [serviceId, rootUrl] of nextRootUrls) {
      if (!entries.has(serviceId)) {
        createEntry(serviceId, rootUrl);
      }
    }
  };

  const closeEntry = (serviceId: string) => {
    const entry = entries.get(serviceId);
    if (!entry) {
      return;
    }

    if (attachedServiceId === serviceId) {
      detachAttachedView();
    }

    entries.delete(serviceId);
    if (!entry.view.webContents.isDestroyed()) {
      try {
        entry.view.webContents.close();
      } catch {
        /* ignore close failures during teardown */
      }
    }
  };

  return {
    activateServiceTab: async (serviceId: string) => {
      const entry = entries.get(serviceId);
      if (!entry) {
        throw new Error(`Unknown viewer service tab: ${serviceId}`);
      }

      activeServiceId = serviceId;
      attachServiceView(serviceId);
      await loadRootUrlIfNeeded(entry);
      return emitState();
    },
    destroy: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      detachAttachedView();
      for (const serviceId of [...entries.keys()]) {
        closeEntry(serviceId);
      }
    },
    getState,
    goBack: () => {
      const activeView = getActiveEntry()?.view;
      if (activeView?.webContents.navigationHistory.canGoBack()) {
        activeView.webContents.navigationHistory.goBack();
      }

      return emitState();
    },
    goForward: () => {
      const activeView = getActiveEntry()?.view;
      if (activeView?.webContents.navigationHistory.canGoForward()) {
        activeView.webContents.navigationHistory.goForward();
      }

      return emitState();
    },
    hide: () => {
      applyBounds({ height: 0, width: 0, x: 0, y: 0 });
      return emitState();
    },
    loadURL: async (url: string) => {
      const activeEntry = getActiveEntry();
      if (!(activeServiceId && activeEntry)) {
        return emitState();
      }

      attachServiceView(activeServiceId);
      await loadUrlSafely(activeEntry, url);
      return emitState();
    },
    openExternal: async () => {
      const currentUrl = activeServiceId
        ? entries.get(activeServiceId)?.view.webContents.getURL()
        : null;
      if (!currentUrl) {
        return { ok: false } as const;
      }

      await shell.openExternal(currentUrl);
      return { ok: true } as const;
    },
    resetActiveTab: async () => {
      const activeEntry = getActiveEntry();
      if (!(activeServiceId && activeEntry)) {
        return emitState();
      }

      attachServiceView(activeServiceId);
      await loadUrlSafely(activeEntry, activeEntry.rootUrl);
      return emitState();
    },
    reload: () => {
      const activeView = getActiveEntry()?.view;
      if (activeView?.webContents.getURL()) {
        activeView.webContents.reload();
      }

      return emitState();
    },
    setBounds: (bounds: ViewerBounds) => {
      applyBounds(bounds);
      return emitState();
    },
    show: (bounds: ViewerBounds) => {
      if (activeServiceId) {
        attachServiceView(activeServiceId);
      }
      applyBounds(bounds);
      return emitState();
    },
    syncServiceTabs: async (tabs: ViewerServiceTab[]) => {
      const nextRootUrls = new Map(
        tabs.map((tab) => [tab.serviceId, tab.rootUrl] as const)
      );

      await syncExistingServiceTabs(nextRootUrls);
      createMissingServiceTabs(nextRootUrls);

      if (activeServiceId && !nextRootUrls.has(activeServiceId)) {
        activeServiceId = tabs[0]?.serviceId ?? null;
      }

      return emitState();
    },
  };
};
