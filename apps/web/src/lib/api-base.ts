const DEFAULT_API_BASE = "http://localhost:3000";

const isConfiguredUrl = (value: string | undefined) =>
  Boolean(value && value !== "undefined");

const resolveApiBase = () => {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  const desktopRuntimeInfo =
    typeof window !== "undefined" ? window.hiveDesktop?.runtimeInfo : undefined;
  const desktopApiUrl = desktopRuntimeInfo?.backendUrl.trim() || undefined;

  if (isConfiguredUrl(desktopApiUrl)) {
    return desktopApiUrl;
  }

  if (typeof window !== "undefined" && !("hiveDesktop" in window)) {
    return window.location.origin;
  }

  if (typeof window !== "undefined" && "hiveDesktop" in window) {
    return DEFAULT_API_BASE;
  }

  if (isConfiguredUrl(envUrl)) {
    return envUrl;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return;
};

export const getApiBase = () => {
  const resolved = resolveApiBase();
  if (!resolved) {
    return DEFAULT_API_BASE;
  }
  return resolved;
};
