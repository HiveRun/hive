import { Notification, shell } from "electron";

export const IPC_CHANNELS = {
  getRuntimeInfo: "hive.desktop.getRuntimeInfo",
  notify: "hive.desktop.notify",
  openExternal: "hive.desktop.openExternal",
} as const;

type NotifyInput = {
  title: string;
  body?: string;
};

export const createIpcHandlers = () => {
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

  return {
    getRuntimeInfo,
    notify,
    openExternal,
  };
};
