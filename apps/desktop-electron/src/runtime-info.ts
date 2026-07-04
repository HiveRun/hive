const DEFAULT_BACKEND_URL = "http://localhost:3000";

type DesktopStartupMode = "starting" | "reconnecting" | "remote-client";

type DesktopRuntimeInfo = {
  runtime: "electron";
  version: string;
  platform: NodeJS.Platform;
  backendUrl: string;
  healthUrl: string;
  instanceName?: string;
  startupMode: DesktopStartupMode;
};

const trimTrailingSlash = (value: string) => {
  if (!value.endsWith("/")) {
    return value;
  }
  return value.slice(0, -1);
};

const normalizeStartupMode = (
  value: string | undefined
): DesktopStartupMode => {
  if (value === "reconnecting") {
    return "reconnecting";
  }

  if (value === "remote-client") {
    return "remote-client";
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
    ...(process.env.HIVE_DESKTOP_INSTANCE_NAME?.trim()
      ? { instanceName: process.env.HIVE_DESKTOP_INSTANCE_NAME.trim() }
      : {}),
    startupMode: normalizeStartupMode(process.env.HIVE_DESKTOP_STARTUP_MODE),
  };
};
