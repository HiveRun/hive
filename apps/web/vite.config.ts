import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const DEFAULT_DEV_SERVER_PORT = 3001;
const DEFAULT_API_SERVER_PORT = "3000";
const resolvedDevPort = Number(process.env.PORT ?? DEFAULT_DEV_SERVER_PORT);
const devServerPort = Number.isNaN(resolvedDevPort)
  ? DEFAULT_DEV_SERVER_PORT
  : resolvedDevPort;
const apiServerPort = process.env.SERVER_PORT ?? DEFAULT_API_SERVER_PORT;

export default defineConfig({
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
        target: `http://localhost:${apiServerPort}`,
        changeOrigin: true,
      },
    },
  },
});
