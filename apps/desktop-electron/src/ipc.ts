import {
  type BrowserWindow,
  type IpcMain,
  Notification,
  shell,
} from "electron";
import { IPC_CHANNELS } from "./ipc-channels";
import type { ViewerBounds } from "./viewer-controller";
import { createViewerController } from "./viewer-controller";

type NotifyInput = {
  title: string;
  body?: string;
};

type IpcHandlers = ReturnType<typeof createIpcHandlers>;

const openExternal = async (url: string) => {
  await shell.openExternal(url);
  return { ok: true } as const;
};

export const createIpcHandlers = (window: BrowserWindow) => {
  let viewer: ReturnType<typeof createViewerController> | null = null;

  const getViewer = () => {
    if (viewer) {
      return viewer;
    }

    viewer = createViewerController({
      onStateChange: (state) => {
        try {
          if (window.isDestroyed() || window.webContents.isDestroyed()) {
            return;
          }

          window.webContents.send(IPC_CHANNELS.viewerStateChanged, state);
        } catch {
          /* ignore teardown races while the window is closing */
        }
      },
      window,
    });

    return viewer;
  };

  const getRuntimeInfo = () => ({
    runtime: "electron" as const,
    version: process.versions.electron,
    platform: process.platform,
  });

  const notify = (input: NotifyInput) => {
    if (!Notification.isSupported()) {
      return { delivered: false } as const;
    }

    const notification = new Notification({
      title: input.title,
      body: input.body,
    });
    notification.show();

    return { delivered: true } as const;
  };

  const viewerGetState = () => getViewer().getState();
  const viewerShow = (bounds: ViewerBounds) => getViewer().show(bounds);
  const viewerHide = () => getViewer().hide();
  const viewerSetBounds = (bounds: ViewerBounds) =>
    getViewer().setBounds(bounds);
  const viewerNavigate = async (url: string) => await getViewer().loadURL(url);
  const viewerGoBack = () => getViewer().goBack();
  const viewerGoForward = () => getViewer().goForward();
  const viewerReload = () => getViewer().reload();
  const viewerOpenExternal = async () => await getViewer().openExternal();

  return {
    getRuntimeInfo,
    notify,
    openExternal,
    viewer: {
      destroy: () => {
        viewer?.destroy();
        viewer = null;
      },
    },
    viewerGetState,
    viewerGoBack,
    viewerGoForward,
    viewerHide,
    viewerNavigate,
    viewerOpenExternal,
    viewerReload,
    viewerSetBounds,
    viewerShow,
  };
};

export const registerIpcHandlers = (options: { ipcMain: IpcMain }) => {
  let activeWindow: BrowserWindow | null = null;
  let activeHandlers: IpcHandlers | null = null;

  const requireHandlers = () => {
    if (!activeHandlers) {
      throw new Error("Desktop window is not available");
    }

    return activeHandlers;
  };

  const attachWindow = (window: BrowserWindow) => {
    if (activeWindow === window && activeHandlers) {
      return activeHandlers;
    }

    activeHandlers?.viewer.destroy();
    activeWindow = window;
    activeHandlers = createIpcHandlers(window);

    return activeHandlers;
  };

  const detachWindow = (window: BrowserWindow) => {
    if (activeWindow !== window) {
      return;
    }

    activeHandlers?.viewer.destroy();
    activeHandlers = null;
    activeWindow = null;
  };

  options.ipcMain.handle(IPC_CHANNELS.getRuntimeInfo, () =>
    requireHandlers().getRuntimeInfo()
  );
  options.ipcMain.handle(IPC_CHANNELS.notify, (_event, payload) =>
    requireHandlers().notify(payload as NotifyInput)
  );
  options.ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url) =>
    openExternal(url as string)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerGetState, () =>
    requireHandlers().viewerGetState()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerShow, (_event, bounds) =>
    requireHandlers().viewerShow(bounds as ViewerBounds)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerHide, () =>
    requireHandlers().viewerHide()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerSetBounds, (_event, bounds) =>
    requireHandlers().viewerSetBounds(bounds as ViewerBounds)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerNavigate, (_event, url) =>
    requireHandlers().viewerNavigate(url as string)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerGoBack, () =>
    requireHandlers().viewerGoBack()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerGoForward, () =>
    requireHandlers().viewerGoForward()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerReload, () =>
    requireHandlers().viewerReload()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerOpenExternal, () =>
    requireHandlers().viewerOpenExternal()
  );

  return {
    attachWindow,
    detachWindow,
    openExternal,
  };
};

export type { IpcHandlers };
export type { ViewerBounds, ViewerState } from "./viewer-controller";
