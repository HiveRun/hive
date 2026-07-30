import {
  type BrowserWindow,
  type IpcMain,
  Notification,
  shell,
} from "electron";
import type { ViewerBounds, ViewerServiceTab } from "./desktop-runtime-types";
import { IPC_CHANNELS } from "./ipc-channels";
import { isTrustedIpcSender } from "./ipc-trust";
import type { MediaPermissionController } from "./media-permissions";
import { getDesktopRuntimeInfo } from "./runtime-info";
import type { DesktopStartupController } from "./startup-controller";
import { createViewerController } from "./viewer-controller";

type NotifyInput = {
  title: string;
  body?: string;
};

type IpcHandlers = ReturnType<typeof createIpcHandlers>;

const blurWindowIfFocused = (window: BrowserWindow) => {
  if (window.isDestroyed()) {
    return;
  }

  if (window.isFocused()) {
    window.blur();
  }
};

const openExternal = async (window: BrowserWindow, url: string) => {
  await shell.openExternal(url, { activate: true });
  blurWindowIfFocused(window);
  return { ok: true } as const;
};

const createIpcHandlers = (
  window: BrowserWindow,
  startupController: DesktopStartupController,
  mediaPermissions: MediaPermissionController
) => {
  let viewer: ReturnType<typeof createViewerController> | null = null;
  const unsubscribeStartup = startupController.subscribe((state) => {
    try {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
      }

      window.webContents.send(IPC_CHANNELS.startupStateChanged, state);
    } catch {
      /* ignore teardown races while the window is closing */
    }
  });

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
      mediaPermissions,
      window,
    });

    return viewer;
  };

  return {
    destroy: () => {
      unsubscribeStartup();
      viewer?.destroy();
      viewer = null;
    },
    getRuntimeInfo: getDesktopRuntimeInfo,
    notify: (input: NotifyInput) => {
      if (!Notification.isSupported()) {
        return { delivered: false } as const;
      }

      new Notification({ title: input.title, body: input.body }).show();
      return { delivered: true } as const;
    },
    openExternal: (url: string) => openExternal(window, url),
    startupGetState: () => startupController.getState(),
    startupRetry: async () => {
      await startupController.retry();
      return startupController.getState();
    },
    viewerActivateServiceTab: (serviceId: string) =>
      getViewer().activateServiceTab(serviceId),
    viewerGetState: () => getViewer().getState(),
    viewerGoBack: () => getViewer().goBack(),
    viewerGoForward: () => getViewer().goForward(),
    viewerHide: () => getViewer().hide(),
    viewerNavigate: (url: string) => getViewer().loadURL(url),
    viewerOpenExternal: () => getViewer().openExternal(),
    viewerResetActiveTab: () => getViewer().resetActiveTab(),
    viewerReload: () => getViewer().reload(),
    viewerSetBounds: (bounds: ViewerBounds) => getViewer().setBounds(bounds),
    viewerShow: (bounds: ViewerBounds) => getViewer().show(bounds),
    viewerSyncServiceTabs: (tabs: ViewerServiceTab[]) =>
      getViewer().syncServiceTabs(tabs),
  };
};

type IpcListener = (handlers: IpcHandlers, args: unknown[]) => unknown;
type IpcRequestChannel = (typeof IPC_CHANNELS)[Exclude<
  keyof typeof IPC_CHANNELS,
  "startupStateChanged" | "viewerStateChanged"
>];

const IPC_LISTENERS = {
  [IPC_CHANNELS.getRuntimeInfo]: (handlers) => handlers.getRuntimeInfo(),
  [IPC_CHANNELS.notify]: (handlers, [payload]) =>
    handlers.notify(payload as NotifyInput),
  [IPC_CHANNELS.openExternal]: (handlers, [url]) =>
    handlers.openExternal(url as string),
  [IPC_CHANNELS.startupGetState]: (handlers) => handlers.startupGetState(),
  [IPC_CHANNELS.startupRetry]: (handlers) => handlers.startupRetry(),
  [IPC_CHANNELS.viewerActivateServiceTab]: (handlers, [serviceId]) =>
    handlers.viewerActivateServiceTab(serviceId as string),
  [IPC_CHANNELS.viewerGetState]: (handlers) => handlers.viewerGetState(),
  [IPC_CHANNELS.viewerGoBack]: (handlers) => handlers.viewerGoBack(),
  [IPC_CHANNELS.viewerGoForward]: (handlers) => handlers.viewerGoForward(),
  [IPC_CHANNELS.viewerHide]: (handlers) => handlers.viewerHide(),
  [IPC_CHANNELS.viewerNavigate]: (handlers, [url]) =>
    handlers.viewerNavigate(url as string),
  [IPC_CHANNELS.viewerOpenExternal]: (handlers) =>
    handlers.viewerOpenExternal(),
  [IPC_CHANNELS.viewerResetActiveTab]: (handlers) =>
    handlers.viewerResetActiveTab(),
  [IPC_CHANNELS.viewerReload]: (handlers) => handlers.viewerReload(),
  [IPC_CHANNELS.viewerSetBounds]: (handlers, [bounds]) =>
    handlers.viewerSetBounds(bounds as ViewerBounds),
  [IPC_CHANNELS.viewerShow]: (handlers, [bounds]) =>
    handlers.viewerShow(bounds as ViewerBounds),
  [IPC_CHANNELS.viewerSyncServiceTabs]: (handlers, [tabs]) =>
    handlers.viewerSyncServiceTabs(tabs as ViewerServiceTab[]),
} satisfies Record<IpcRequestChannel, IpcListener>;

export const registerIpcHandlers = (options: {
  ipcMain: IpcMain;
  mediaPermissions: MediaPermissionController;
  startupController: DesktopStartupController;
}) => {
  let activeWindow: BrowserWindow | null = null;
  let activeHandlers: IpcHandlers | null = null;

  const requireHandlers = () => {
    if (!activeHandlers) {
      throw new Error("Desktop window is not available");
    }

    return activeHandlers;
  };

  const requireTrustedHandlers = (event: Electron.IpcMainInvokeEvent) => {
    if (
      !isTrustedIpcSender(
        activeWindow?.webContents ?? null,
        event.sender,
        options.mediaPermissions.isTrustedRenderer
      )
    ) {
      throw new Error("IPC request rejected from untrusted sender");
    }

    return requireHandlers();
  };

  for (const [channel, listener] of Object.entries(IPC_LISTENERS)) {
    options.ipcMain.handle(channel, (event, ...args) =>
      listener(requireTrustedHandlers(event), args)
    );
  }

  const attachWindow = (window: BrowserWindow) => {
    if (activeWindow === window && activeHandlers) {
      return activeHandlers;
    }

    activeHandlers?.destroy();
    activeWindow = window;
    activeHandlers = createIpcHandlers(
      window,
      options.startupController,
      options.mediaPermissions
    );

    return activeHandlers;
  };

  const detachWindow = (window: BrowserWindow) => {
    if (activeWindow !== window) {
      return;
    }

    activeHandlers?.destroy();
    activeHandlers = null;
    activeWindow = null;
  };

  return {
    attachWindow,
    detachWindow,
    openExternal: async (url: string) =>
      await requireHandlers().openExternal(url),
  };
};
