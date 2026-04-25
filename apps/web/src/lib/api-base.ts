const DEFAULT_API_BASE = "http://localhost:3000";

export const resolveApiBase = () => {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  const desktopRuntimeInfo =
    typeof window !== "undefined" ? window.hiveDesktop?.runtimeInfo : undefined;
  const desktopApiUrl = desktopRuntimeInfo?.backendUrl.trim() || undefined;

  if (desktopApiUrl && desktopApiUrl !== "undefined") {
    return desktopApiUrl;
  }

  if (envUrl && envUrl !== "undefined") {
    return envUrl;
  }

  if (typeof window !== "undefined" && "hiveDesktop" in window) {
    return DEFAULT_API_BASE;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return;
};

export const getApiBase = () => {
  const resolved = resolveApiBase();
  if (!resolved) {
    throw new Error(
      "VITE_API_URL is required. Set it to your API origin, e.g. http://localhost:3000"
    );
  }
  return resolved;
};
