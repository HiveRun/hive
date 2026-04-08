import {
  type BrowserWindow,
  type IpcMainInvokeEvent,
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

export const createIpcHandlers = (window: BrowserWindow) => {
  let viewer: ReturnType<typeof createViewerController> | null = null;

  const getViewer = () => {
    if (viewer) {
      return viewer;
    }

    viewer = createViewerController({
      onStateChange: (state) => {
        if (!window.webContents.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.viewerStateChanged, state);
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

  const openExternal = async (url: string) => {
    await shell.openExternal(url);
    return { ok: true } as const;
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

export const registerIpcHandlers = (options: {
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ) => void;
  };
  window: BrowserWindow;
}) => {
  const handlers = createIpcHandlers(options.window);

  options.ipcMain.handle(IPC_CHANNELS.getRuntimeInfo, () =>
    handlers.getRuntimeInfo()
  );
  options.ipcMain.handle(IPC_CHANNELS.notify, (_event, payload) =>
    handlers.notify(payload as NotifyInput)
  );
  options.ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url) =>
    handlers.openExternal(url as string)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerGetState, () =>
    handlers.viewerGetState()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerShow, (_event, bounds) =>
    handlers.viewerShow(bounds as ViewerBounds)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerHide, () => handlers.viewerHide());
  options.ipcMain.handle(IPC_CHANNELS.viewerSetBounds, (_event, bounds) =>
    handlers.viewerSetBounds(bounds as ViewerBounds)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerNavigate, (_event, url) =>
    handlers.viewerNavigate(url as string)
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerGoBack, () =>
    handlers.viewerGoBack()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerGoForward, () =>
    handlers.viewerGoForward()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerReload, () =>
    handlers.viewerReload()
  );
  options.ipcMain.handle(IPC_CHANNELS.viewerOpenExternal, () =>
    handlers.viewerOpenExternal()
  );

  return handlers;
};

export type { IpcHandlers };
export type { ViewerBounds, ViewerState } from "./viewer-controller";
