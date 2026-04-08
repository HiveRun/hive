type DesktopNotifyInput = {
  title: string;
  body?: string;
};

type DesktopNotifyResult = {
  delivered: boolean;
};

type DesktopViewerBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DesktopViewerState = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

type DesktopRuntimeBridge = {
  notify: (payload: DesktopNotifyInput) => Promise<DesktopNotifyResult>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  getRuntimeInfo: () => Promise<{
    runtime: "electron";
    version: string;
    platform: string;
  }>;
  viewer: {
    getState: () => Promise<DesktopViewerState>;
    goBack: () => Promise<DesktopViewerState>;
    goForward: () => Promise<DesktopViewerState>;
    hide: () => Promise<DesktopViewerState>;
    navigate: (url: string) => Promise<DesktopViewerState>;
    openExternal: () => Promise<{ ok: boolean }>;
    reload: () => Promise<DesktopViewerState>;
    setBounds: (bounds: DesktopViewerBounds) => Promise<DesktopViewerState>;
    show: (bounds: DesktopViewerBounds) => Promise<DesktopViewerState>;
    subscribe: (listener: (state: DesktopViewerState) => void) => () => void;
  };
};

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: must extend DOM Window interface
  interface Window {
    hiveDesktop?: DesktopRuntimeBridge;
  }
}

export {};
