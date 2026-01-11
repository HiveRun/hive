const DEFAULT_API_BASE = "http://localhost:3000";

export const resolveApiBase = () => {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  if (envUrl && envUrl !== "undefined") {
    return envUrl;
  }

  if (isTauri) {
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
