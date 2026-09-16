import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const DEFAULT_DEV_SERVER_PORT = 3001;
const DEFAULT_API_SERVER_PORT = "3000";
const ROUTE_FILE_IGNORE_PATTERN = "\\.(test|spec)\\.(ts|tsx|js|jsx)$";
export function resolveDevServerPort(env: NodeJS.ProcessEnv = process.env) {
  const resolvedPort = Number(
    env.HIVE_DESKTOP_DEV_PORT ??
      env.PORT ??
      env.WEB_PORT ??
      DEFAULT_DEV_SERVER_PORT
  );
  return Number.isNaN(resolvedPort) ? DEFAULT_DEV_SERVER_PORT : resolvedPort;
}
const devServerPort = resolveDevServerPort();
const fallbackApiServerPort =
  process.env.SERVER_PORT ?? DEFAULT_API_SERVER_PORT;

function desktopRendererReadyPlugin() {
  const readyFilePath = process.env.HIVE_DESKTOP_RENDERER_READY_FILE;
  const readyToken = process.env.HIVE_DESKTOP_READY_TOKEN;
  if (!(readyFilePath && readyToken)) {
    return null;
  }

  return {
    name: "hive-desktop-renderer-ready",
    configureServer(server: ViteDevServer) {
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (!(address && typeof address !== "string")) {
          return;
        }
        mkdirSync(dirname(readyFilePath), { recursive: true });
        writeFileSync(
          readyFilePath,
          JSON.stringify({ pid: process.pid, port: address.port, readyToken }),
          "utf8"
        );
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const requiredApiUrl =
    process.env.VITE_API_URL?.trim() || env.VITE_API_URL?.trim();
  const buildBase = env.VITE_APP_BASE?.trim() || "/";

  if (!requiredApiUrl || requiredApiUrl === "undefined") {
    throw new Error(
      "VITE_API_URL is required. Set it before running dev/build (e.g. http://localhost:3000)."
    );
  }

  return {
    base: buildBase,
    plugins: [
      tsconfigPaths({
        root: "./",
      }),
      tailwindcss(),
      tanstackRouter({
        routeFileIgnorePattern: ROUTE_FILE_IGNORE_PATTERN,
      }),
      viteReact(),
      desktopRendererReadyPlugin(),
    ],
    build: {
      rollupOptions: {
        external: ["node:child_process"],
      },
    },
    server: {
      headers: process.env.HIVE_DESKTOP_READY_TOKEN
        ? {
            "X-Hive-Desktop-Ready": process.env.HIVE_DESKTOP_READY_TOKEN,
          }
        : undefined,
      host: process.env.HIVE_DESKTOP_DEV_HOST,
      port: devServerPort,
      proxy: {
        "/api": {
          target: requiredApiUrl ?? `http://localhost:${fallbackApiServerPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
