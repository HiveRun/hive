const DEFAULT_BACKEND_URL = "http://localhost:3000";

export type DesktopStartupMode = "starting" | "reconnecting";

export type DesktopRuntimeInfo = {
  runtime: "electron";
  version: string;
  platform: NodeJS.Platform;
  backendUrl: string;
  healthUrl: string;
  startupMode: DesktopStartupMode;
};

const trimTrailingSlash = (value: string) =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const normalizeStartupMode = (
  value: string | undefined
): DesktopStartupMode => {
  if (value === "reconnecting") {
    return "reconnecting";
  }

  return "starting";
};

const resolveBackendUrl = () =>
  trimTrailingSlash(
    process.env.HIVE_DESKTOP_BACKEND_URL?.trim() ||
      process.env.VITE_API_URL?.trim() ||
      DEFAULT_BACKEND_URL
  );

export const getDesktopRuntimeInfo = (): DesktopRuntimeInfo => {
  const backendUrl = resolveBackendUrl();

  return {
    runtime: "electron",
    version: process.versions.electron,
    platform: process.platform,
    backendUrl,
    healthUrl:
      process.env.HIVE_DESKTOP_HEALTH_URL?.trim() || `${backendUrl}/health`,
    startupMode: normalizeStartupMode(process.env.HIVE_DESKTOP_STARTUP_MODE),
  };
};
