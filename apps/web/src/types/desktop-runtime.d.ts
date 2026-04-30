type DesktopNotifyInput = {
  title: string;
  body?: string;
};

type DesktopNotifyResult = {
  delivered: boolean;
};

type DesktopRuntimeInfo = {
  runtime: "electron";
  version: string;
  platform: string;
  backendUrl: string;
  healthUrl: string;
  startupMode: "starting" | "reconnecting";
};

type DesktopStartupState = {
  phase:
    | "idle"
    | "detecting-daemon"
    | "starting-daemon"
    | "waiting-for-api"
    | "api-ready"
    | "error";
  message: string;
  backendUrl: string;
  healthUrl: string;
  pid?: number | null;
  startedAt: number;
  updatedAt: number;
  error?: string;
};

type DesktopViewerBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DesktopViewerState = {
  activeServiceId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

type DesktopViewerServiceTab = {
  serviceId: string;
  rootUrl: string;
};

type DesktopRuntimeBridge = {
  runtimeInfo: DesktopRuntimeInfo;
  notify: (payload: DesktopNotifyInput) => Promise<DesktopNotifyResult>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  startup?: {
    getState: () => Promise<DesktopStartupState>;
    retry: () => Promise<DesktopStartupState>;
    subscribe: (listener: (state: DesktopStartupState) => void) => () => void;
  };
  viewer: {
    activateServiceTab: (serviceId: string) => Promise<DesktopViewerState>;
    getState: () => Promise<DesktopViewerState>;
    goBack: () => Promise<DesktopViewerState>;
    goForward: () => Promise<DesktopViewerState>;
    hide: () => Promise<DesktopViewerState>;
    navigate: (url: string) => Promise<DesktopViewerState>;
    openExternal: () => Promise<{ ok: boolean }>;
    resetActiveTab: () => Promise<DesktopViewerState>;
    reload: () => Promise<DesktopViewerState>;
    setBounds: (bounds: DesktopViewerBounds) => Promise<DesktopViewerState>;
    show: (bounds: DesktopViewerBounds) => Promise<DesktopViewerState>;
    syncServiceTabs: (
      tabs: DesktopViewerServiceTab[]
    ) => Promise<DesktopViewerState>;
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
