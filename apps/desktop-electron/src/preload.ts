import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./ipc";

type NotificationInput = {
  title: string;
  body?: string;
};

const hiveDesktopBridge = {
  getRuntimeInfo: async () =>
    await ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
  notify: async (payload: NotificationInput) =>
    await ipcRenderer.invoke(IPC_CHANNELS.notify, payload),
  openExternal: async (url: string) =>
    await ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
};

contextBridge.exposeInMainWorld("hiveDesktop", hiveDesktopBridge);
