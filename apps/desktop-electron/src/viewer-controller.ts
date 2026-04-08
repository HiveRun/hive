import {
  BrowserView,
  type BrowserWindow,
  type Rectangle,
  shell,
} from "electron";

export type ViewerBounds = Pick<Rectangle, "x" | "y" | "width" | "height">;

export type ViewerState = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

type ViewerController = {
  destroy: () => void;
  getState: () => ViewerState;
  goBack: () => ViewerState;
  goForward: () => ViewerState;
  hide: () => ViewerState;
  loadURL: (url: string) => Promise<ViewerState>;
  openExternal: () => Promise<{ ok: boolean }>;
  reload: () => ViewerState;
  setBounds: (bounds: ViewerBounds) => ViewerState;
  show: (bounds: ViewerBounds) => ViewerState;
};

export const createViewerController = (options: {
  onStateChange: (state: ViewerState) => void;
  window: BrowserWindow;
}): ViewerController => {
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let attached = false;
  let lastBounds: ViewerBounds = { height: 0, width: 0, x: 0, y: 0 };

  const getState = (): ViewerState => ({
    canGoBack: view.webContents.navigationHistory.canGoBack(),
    canGoForward: view.webContents.navigationHistory.canGoForward(),
    isLoading: view.webContents.isLoading(),
    isVisible: attached,
    title: view.webContents.getTitle(),
    url: view.webContents.getURL() || null,
  });

  const emitState = () => {
    const nextState = getState();
    options.onStateChange(nextState);
    return nextState;
  };

  const applyBounds = (bounds: ViewerBounds) => {
    lastBounds = bounds;
    view.setBounds(bounds);
  };

  const attach = () => {
    if (attached) {
      return;
    }

    options.window.addBrowserView(view);
    attached = true;
    applyBounds(lastBounds);
  };

  const detach = () => {
    if (!attached) {
      return;
    }

    options.window.removeBrowserView(view);
    attached = false;
  };

  const handleWindowOpen = ({ url }: { url: string }) => {
    shell.openExternal(url).catch(() => {
      /* ignore open failures */
    });

    return { action: "deny" as const };
  };

  view.webContents.setWindowOpenHandler(handleWindowOpen);

  view.webContents.on("did-start-loading", emitState);
  view.webContents.on("did-stop-loading", emitState);
  view.webContents.on("did-navigate", emitState);
  view.webContents.on("did-navigate-in-page", emitState);
  view.webContents.on("page-title-updated", emitState);

  view.webContents.on("destroyed", () => {
    detach();
    emitState();
  });

  return {
    destroy: () => {
      detach();
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    },
    getState,
    goBack: () => {
      if (view.webContents.navigationHistory.canGoBack()) {
        view.webContents.navigationHistory.goBack();
      }

      return emitState();
    },
    goForward: () => {
      if (view.webContents.navigationHistory.canGoForward()) {
        view.webContents.navigationHistory.goForward();
      }

      return emitState();
    },
    hide: () => {
      detach();
      return emitState();
    },
    loadURL: async (url: string) => {
      attach();
      await view.webContents.loadURL(url);
      return emitState();
    },
    openExternal: async () => {
      const currentUrl = view.webContents.getURL();
      if (!currentUrl) {
        return { ok: false } as const;
      }

      await shell.openExternal(currentUrl);
      return { ok: true } as const;
    },
    reload: () => {
      if (view.webContents.getURL()) {
        view.webContents.reload();
      }

      return emitState();
    },
    setBounds: (bounds: ViewerBounds) => {
      applyBounds(bounds);
      return emitState();
    },
    show: (bounds: ViewerBounds) => {
      applyBounds(bounds);
      attach();
      return emitState();
    },
  };
};
