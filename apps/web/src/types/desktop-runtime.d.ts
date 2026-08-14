declare global {
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

  type DesktopStartupPhase =
    | "idle"
    | "detecting-daemon"
    | "starting-daemon"
    | "waiting-for-api"
    | "api-ready"
    | "error";

  type DesktopStartupState = Record<
    "backendUrl" | "healthUrl" | "message",
    string
  > &
    Record<"startedAt" | "updatedAt", number> & {
      phase: DesktopStartupPhase;
      pid?: number | null;
      error?: string;
    };

  type DesktopViewerBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  type DesktopViewerState = Record<
    "canGoBack" | "canGoForward" | "isLoading" | "isVisible",
    boolean
  > & {
    activeServiceId: string | null;
    title: string;
    url: string | null;
  };

  type DesktopViewerServiceTab = {
    audioInput: boolean;
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

  // biome-ignore lint/style/useConsistentTypeDefinitions: must extend DOM Window interface
  interface Window {
    hiveDesktop?: DesktopRuntimeBridge;
  }
}

export {};
