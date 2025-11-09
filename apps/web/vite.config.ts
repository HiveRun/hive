import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

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
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
