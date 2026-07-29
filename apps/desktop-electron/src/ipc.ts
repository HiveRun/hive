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

  const getRuntimeInfo = () => getDesktopRuntimeInfo();

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
  const startupGetState = () => startupController.getState();
  const startupRetry = async () => {
    await startupController.retry();
    return startupController.getState();
  };
  const viewerActivateServiceTab = async (serviceId: string) =>
    await getViewer().activateServiceTab(serviceId);
  const viewerShow = (bounds: ViewerBounds) => getViewer().show(bounds);
  const viewerHide = () => getViewer().hide();
  const viewerSetBounds = (bounds: ViewerBounds) =>
    getViewer().setBounds(bounds);
  const viewerNavigate = async (url: string) => await getViewer().loadURL(url);
  const viewerGoBack = () => getViewer().goBack();
  const viewerGoForward = () => getViewer().goForward();
  const viewerResetActiveTab = async () => await getViewer().resetActiveTab();
  const viewerReload = () => getViewer().reload();
  const viewerOpenExternal = async () => await getViewer().openExternal();
  const viewerSyncServiceTabs = async (tabs: ViewerServiceTab[]) =>
    await getViewer().syncServiceTabs(tabs);
  const appOpenExternal = async (url: string) =>
    await openExternal(window, url);

  return {
    getRuntimeInfo,
    notify,
    openExternal: appOpenExternal,
    startupGetState,
    startupRetry,
    viewer: {
      destroy: () => {
        unsubscribeStartup();
        viewer?.destroy();
        viewer = null;
      },
    },
    viewerActivateServiceTab,
    viewerGetState,
    viewerGoBack,
    viewerGoForward,
    viewerHide,
    viewerNavigate,
    viewerOpenExternal,
    viewerResetActiveTab,
    viewerReload,
    viewerSetBounds,
    viewerShow,
    viewerSyncServiceTabs,
  };
};

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
      !isTrustedIpcSender({
        activeContents: activeWindow?.webContents ?? null,
        isTrusted: options.mediaPermissions.isTrustedRenderer,
        sender: event.sender,
      })
    ) {
      throw new Error("IPC request rejected from untrusted sender");
    }

    return requireHandlers();
  };

  const handle = (
    channel: string,
    listener: (handlers: IpcHandlers, args: unknown[]) => unknown
  ) => {
    options.ipcMain.handle(channel, (event, ...args) =>
      listener(requireTrustedHandlers(event), args)
    );
  };

  const attachWindow = (window: BrowserWindow) => {
    if (activeWindow === window && activeHandlers) {
      return activeHandlers;
    }

    activeHandlers?.viewer.destroy();
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

    activeHandlers?.viewer.destroy();
    activeHandlers = null;
    activeWindow = null;
  };

  handle(IPC_CHANNELS.getRuntimeInfo, (handlers) => handlers.getRuntimeInfo());
  handle(IPC_CHANNELS.notify, (handlers, [payload]) =>
    handlers.notify(payload as NotifyInput)
  );
  handle(IPC_CHANNELS.openExternal, (handlers, [url]) =>
    handlers.openExternal(url as string)
  );
  handle(IPC_CHANNELS.startupGetState, (handlers) =>
    handlers.startupGetState()
  );
  handle(IPC_CHANNELS.startupRetry, (handlers) => handlers.startupRetry());
  handle(IPC_CHANNELS.viewerGetState, (handlers) => handlers.viewerGetState());
  handle(IPC_CHANNELS.viewerActivateServiceTab, (handlers, [serviceId]) =>
    handlers.viewerActivateServiceTab(serviceId as string)
  );
  handle(IPC_CHANNELS.viewerShow, (handlers, [bounds]) =>
    handlers.viewerShow(bounds as ViewerBounds)
  );
  handle(IPC_CHANNELS.viewerHide, (handlers) => handlers.viewerHide());
  handle(IPC_CHANNELS.viewerSetBounds, (handlers, [bounds]) =>
    handlers.viewerSetBounds(bounds as ViewerBounds)
  );
  handle(IPC_CHANNELS.viewerNavigate, (handlers, [url]) =>
    handlers.viewerNavigate(url as string)
  );
  handle(IPC_CHANNELS.viewerGoBack, (handlers) => handlers.viewerGoBack());
  handle(IPC_CHANNELS.viewerGoForward, (handlers) =>
    handlers.viewerGoForward()
  );
  handle(IPC_CHANNELS.viewerResetActiveTab, (handlers) =>
    handlers.viewerResetActiveTab()
  );
  handle(IPC_CHANNELS.viewerReload, (handlers) => handlers.viewerReload());
  handle(IPC_CHANNELS.viewerOpenExternal, (handlers) =>
    handlers.viewerOpenExternal()
  );
  handle(IPC_CHANNELS.viewerSyncServiceTabs, (handlers, [tabs]) =>
    handlers.viewerSyncServiceTabs(tabs as ViewerServiceTab[])
  );

  return {
    attachWindow,
    detachWindow,
    openExternal: async (url: string) =>
      await requireHandlers().openExternal(url),
  };
};
