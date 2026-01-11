import { treaty } from "@elysiajs/eden";
import type { App } from "@hive/server";

const API_URL = (() => {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  let resolvedUrl: string | undefined;

  if (envUrl && envUrl !== "undefined") {
    resolvedUrl = envUrl;
  } else if (isTauri) {
    resolvedUrl = "http://localhost:3000";
  } else if (typeof window !== "undefined") {
    resolvedUrl = window.location.origin;
  }

  if (!resolvedUrl) {
    // biome-ignore lint/suspicious/noConsole: hard-stop misconfigurations in dev
    console.error(
      "VITE_API_URL is required. Set it to your API origin, e.g. http://localhost:3000"
    );
    throw new Error(
      "VITE_API_URL is required. Set it to your API origin, e.g. http://localhost:3000"
    );
  }

  return resolvedUrl;
})();

export const rpc = treaty<App>(API_URL);

// Helper types for convenience - inferred from Eden Treaty
export type CreateCellInput = Parameters<typeof rpc.api.cells.post>[0];
