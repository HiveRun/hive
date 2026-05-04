import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopStartupState,
  ViewerBounds,
  ViewerServiceTab,
  ViewerState,
} from "./desktop-runtime-types";
import { IPC_CHANNELS } from "./ipc-channels";
import { getDesktopRuntimeInfo } from "./runtime-info";

type NotificationInput = {
  title: string;
  body?: string;
};

const hiveDesktopBridge = {
  runtimeInfo: getDesktopRuntimeInfo(),
  getRuntimeInfo: async () =>
    await ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
  notify: async (payload: NotificationInput) =>
    await ipcRenderer.invoke(IPC_CHANNELS.notify, payload),
  openExternal: async (url: string) =>
    await ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  startup: {
    getState: async () =>
      await ipcRenderer.invoke(IPC_CHANNELS.startupGetState),
    retry: async () => await ipcRenderer.invoke(IPC_CHANNELS.startupRetry),
    subscribe: (listener: (state: DesktopStartupState) => void) => {
      const wrappedListener = (_event: unknown, state: DesktopStartupState) => {
        listener(state);
      };

      ipcRenderer.on(IPC_CHANNELS.startupStateChanged, wrappedListener);
      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.startupStateChanged,
          wrappedListener
        );
      };
    },
  },
  viewer: {
    activateServiceTab: async (serviceId: string) =>
      await ipcRenderer.invoke(
        IPC_CHANNELS.viewerActivateServiceTab,
        serviceId
      ),
    getState: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerGetState),
    goBack: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerGoBack),
    goForward: async () =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerGoForward),
    hide: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerHide),
    navigate: async (url: string) =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerNavigate, url),
    openExternal: async () =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerOpenExternal),
    resetActiveTab: async () =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerResetActiveTab),
    reload: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerReload),
    setBounds: async (bounds: ViewerBounds) =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerSetBounds, bounds),
    show: async (bounds: ViewerBounds) =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerShow, bounds),
    syncServiceTabs: async (tabs: ViewerServiceTab[]) =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerSyncServiceTabs, tabs),
    subscribe: (listener: (state: ViewerState) => void) => {
      const wrappedListener = (_event: unknown, state: ViewerState) => {
        listener(state);
      };

      ipcRenderer.on(IPC_CHANNELS.viewerStateChanged, wrappedListener);
      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.viewerStateChanged,
          wrappedListener
        );
      };
    },
  },
};

contextBridge.exposeInMainWorld("hiveDesktop", hiveDesktopBridge);
