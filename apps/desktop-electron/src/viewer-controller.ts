import { BrowserView, type BrowserWindow, shell } from "electron";
import type {
  ViewerBounds,
  ViewerServiceTab,
  ViewerState,
} from "./desktop-runtime-types";
import type { MediaPermissionController } from "./media-permissions";

type ViewerEntry = {
  audioInput: boolean;
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
  mediaPermissions: MediaPermissionController;
  onStateChange: (state: ViewerState) => void;
  window: BrowserWindow;
}): ViewerController => {
  const entries = new Map<string, ViewerEntry>();
  let serviceTabs = new Map<string, ViewerServiceTab>();
  let activeServiceId: string | null = null;
  let attachedServiceId: string | null = null;
  let disposed = false;
  let visible = false;
  let lastBounds: ViewerBounds = { height: 0, width: 0, x: 0, y: 0 };

  const getState = (): ViewerState => {
    const activeEntry = activeServiceId ? entries.get(activeServiceId) : null;
    const activeView = activeEntry?.view;
    if (!activeView || activeView.webContents.isDestroyed()) {
      return {
        activeServiceId,
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        isVisible: visible,
        title: "",
        url: null,
      };
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
      if (options.window.isFocused()) {
        options.window.webContents.focus();
      }
    } catch {
      /* ignore detach failures while Electron destroys the view */
    }
  };

  const attachServiceView = (serviceId: string) => {
    const entry = entries.get(serviceId);
    if (entry === undefined) {
      return;
    }

    if (serviceId === attachedServiceId) {
      applyBounds(lastBounds);
      return;
    }

    detachAttachedView();
    options.window.addBrowserView(entry.view);
    attachedServiceId = serviceId;
    applyBounds(lastBounds);
  };

  const openExternalUrl = async (url: string) => {
    await shell.openExternal(url, { activate: true });

    if (!options.window.isDestroyed() && options.window.isFocused()) {
      options.window.blur();
    }
  };

  const emitStateForService = (serviceId: string) => {
    if (serviceId === activeServiceId) {
      emitState();
    }
  };

  const loadUrlSafely = async (entry: ViewerEntry, url: string) => {
    try {
      await entry.view.webContents.loadURL(url);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes("ERR_ABORTED") ||
            error.message.includes("-3"))
        )
      ) {
        throw error;
      }
    }
  };

  const createEntry = (tab: ViewerServiceTab) => {
    const { audioInput, rootUrl, serviceId } = tab;
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const entry: ViewerEntry = { audioInput, rootUrl, view };

    options.mediaPermissions.registerViewer(
      view.webContents,
      rootUrl,
      audioInput
    );
    view.webContents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url).catch(() => {
        /* ignore open failures */
      });
      return { action: "deny" };
    });
    const updateState = () => emitStateForService(serviceId);
    view.webContents.on("did-start-loading", updateState);
    view.webContents.on("did-stop-loading", updateState);
    view.webContents.on("did-navigate", updateState);
    view.webContents.on("did-navigate-in-page", updateState);
    view.webContents.on("page-title-updated", updateState);
    view.webContents.on("destroyed", () => {
      if (entries.get(serviceId) !== entry) {
        return;
      }

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

  const getActiveEntry = () =>
    activeServiceId ? (entries.get(activeServiceId) ?? null) : null;

  const loadActiveEntryUrl = async (
    urlForEntry: (entry: ViewerEntry) => string
  ) => {
    const activeEntry = getActiveEntry();
    if (!(activeServiceId && activeEntry)) {
      return emitState();
    }

    attachServiceView(activeServiceId);
    await loadUrlSafely(activeEntry, urlForEntry(activeEntry));
    return emitState();
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
    options.mediaPermissions.unregisterViewer(entry.view.webContents);
    if (!entry.view.webContents.isDestroyed()) {
      try {
        entry.view.webContents.close();
      } catch {
        /* ignore destroy failures during teardown */
      }
    }
  };

  const closeAllEntries = () => {
    activeServiceId = null;
    for (const serviceId of entries.keys()) {
      closeEntry(serviceId);
    }
  };

  return {
    activateServiceTab: async (serviceId: string) => {
      const tab = serviceTabs.get(serviceId);
      if (!tab) {
        throw new Error(`Unknown viewer service tab: ${serviceId}`);
      }

      if (activeServiceId !== serviceId) {
        const previousServiceId = activeServiceId;
        activeServiceId = serviceId;
        if (previousServiceId) {
          closeEntry(previousServiceId);
        }
      }
      const entry = entries.get(serviceId) ?? createEntry(tab);
      attachServiceView(serviceId);
      if (!entry.view.webContents.getURL()) {
        await loadUrlSafely(entry, entry.rootUrl);
      }
      return emitState();
    },
    destroy: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      closeAllEntries();
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
      closeAllEntries();
      return emitState();
    },
    loadURL: (url: string) => loadActiveEntryUrl(() => url),
    openExternal: async () => {
      const currentUrl = activeServiceId
        ? entries.get(activeServiceId)?.view.webContents.getURL()
        : null;
      if (!currentUrl) {
        return { ok: false } as const;
      }

      await openExternalUrl(currentUrl);
      return { ok: true } as const;
    },
    resetActiveTab: () => loadActiveEntryUrl((entry) => entry.rootUrl),
    reload: () => {
      const activeView = getActiveEntry()?.view;
      if (activeView?.webContents.getURL()) {
        activeView.webContents.reload();
      }

      return emitState();
    },
    setBounds: (bounds: ViewerBounds) => {
      applyBounds(bounds);
      if (bounds.width <= 0 || bounds.height <= 0) {
        closeAllEntries();
      }
      return emitState();
    },
    show: (bounds: ViewerBounds) => {
      if (activeServiceId) {
        attachServiceView(activeServiceId);
      }
      applyBounds(bounds);
      return emitState();
    },
    syncServiceTabs: (tabs: ViewerServiceTab[]) => {
      const nextServiceTabs = new Map(
        tabs.map((tab) => [tab.serviceId, tab] as const)
      );

      for (const [serviceId, entry] of entries) {
        const nextTab = nextServiceTabs.get(serviceId);
        if (
          !nextTab ||
          nextTab.rootUrl !== entry.rootUrl ||
          nextTab.audioInput !== entry.audioInput
        ) {
          closeEntry(serviceId);
        }
      }
      serviceTabs = nextServiceTabs;

      if (activeServiceId && !nextServiceTabs.has(activeServiceId)) {
        activeServiceId = tabs[0]?.serviceId ?? null;
      }

      return Promise.resolve(emitState());
    },
  };
};
