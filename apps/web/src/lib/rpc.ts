import { treaty } from "@elysiajs/eden";
import type { App } from "@synthetic/server";

const DEFAULT_API_URL = "http://localhost:3000";
const isBrowser = typeof window !== "undefined";
const tauriCandidate = isBrowser
  ? (window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown })
  : undefined;
const hasTauriBridge = Boolean(
  tauriCandidate?.__TAURI__ ?? tauriCandidate?.__TAURI_IPC__
);

// Desktop builds render from the `tauri://` scheme, so they must directly
// target the HTTP API origin instead of relying on window.location.
const API_URL = (() => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (hasTauriBridge) {
    return DEFAULT_API_URL;
  }

  if (isBrowser) {
    return window.location.origin;
  }

  return DEFAULT_API_URL;
})();

export const rpc = treaty<App>(API_URL);

// Helper types for convenience - inferred from Eden Treaty
export type CreateConstructInput = Parameters<
  typeof rpc.api.constructs.post
>[0];
