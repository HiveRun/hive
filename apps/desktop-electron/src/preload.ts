import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./ipc";

type NotificationInput = {
  title: string;
  body?: string;
};

type ViewerBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ViewerState = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

const hiveDesktopBridge = {
  getRuntimeInfo: async () =>
    await ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
  notify: async (payload: NotificationInput) =>
    await ipcRenderer.invoke(IPC_CHANNELS.notify, payload),
  openExternal: async (url: string) =>
    await ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  viewer: {
    getState: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerGetState),
    goBack: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerGoBack),
    goForward: async () =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerGoForward),
    hide: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerHide),
    navigate: async (url: string) =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerNavigate, url),
    openExternal: async () =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerOpenExternal),
    reload: async () => await ipcRenderer.invoke(IPC_CHANNELS.viewerReload),
    setBounds: async (bounds: ViewerBounds) =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerSetBounds, bounds),
    show: async (bounds: ViewerBounds) =>
      await ipcRenderer.invoke(IPC_CHANNELS.viewerShow, bounds),
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
