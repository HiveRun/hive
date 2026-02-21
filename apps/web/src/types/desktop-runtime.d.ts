type DesktopNotifyInput = {
  title: string;
  body?: string;
};

type DesktopNotifyResult = {
  delivered: boolean;
};

type DesktopRuntimeBridge = {
  notify: (payload: DesktopNotifyInput) => Promise<DesktopNotifyResult>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  getRuntimeInfo: () => Promise<{
    runtime: "electron";
    version: string;
    platform: string;
  }>;
};

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: must extend DOM Window interface
  interface Window {
    hiveDesktop?: DesktopRuntimeBridge;
  }
}

export {};
