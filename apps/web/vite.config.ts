import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const DEFAULT_DEV_SERVER_PORT = 3001;
const DEFAULT_API_SERVER_PORT = "3000";
const resolvedDevPort = Number(process.env.PORT ?? DEFAULT_DEV_SERVER_PORT);
const devServerPort = Number.isNaN(resolvedDevPort)
  ? DEFAULT_DEV_SERVER_PORT
  : resolvedDevPort;
const fallbackApiServerPort =
  process.env.SERVER_PORT ?? DEFAULT_API_SERVER_PORT;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const requiredApiUrl = env.VITE_API_URL?.trim();

  if (!requiredApiUrl || requiredApiUrl === "undefined") {
    throw new Error(
      "VITE_API_URL is required. Set it before running dev/build (e.g. http://localhost:3000)."
    );
  }

  return {
    plugins: [
      tsconfigPaths({
        root: "./",
      }),
      tailwindcss(),
      tanstackRouter(),
      viteReact(),
    ],
    resolve: {
      alias: {
        // Prevent OpenCode SDK server code from being bundled (browser incompatible)
        "@opencode-ai/sdk/dist/server.js": "@opencode-ai/sdk",
      },
    },
    build: {
      rollupOptions: {
        external: ["node:child_process"],
      },
    },
    server: {
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
