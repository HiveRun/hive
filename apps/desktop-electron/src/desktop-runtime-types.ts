import type { Rectangle } from "electron";

export type DesktopStartupPhase =
  | "idle"
  | "detecting-daemon"
  | "starting-daemon"
  | "waiting-for-api"
  | "api-ready"
  | "error";

export type DesktopStartupState = {
  phase: DesktopStartupPhase;
  message: string;
  backendUrl: string;
  healthUrl: string;
  pid?: number | null;
  startedAt: number;
  updatedAt: number;
  error?: string;
};

export type ViewerBounds = Pick<Rectangle, "x" | "y" | "width" | "height">;

export type ViewerState = {
  activeServiceId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isVisible: boolean;
  title: string;
  url: string | null;
};

export type ViewerServiceTab = {
  serviceId: string;
  rootUrl: string;
};
