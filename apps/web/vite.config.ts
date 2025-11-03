import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const plugins: PluginOption[] = [
  tsconfigPaths({
    root: "./",
  }) as PluginOption,
  tailwindcss() as PluginOption,
  tanstackRouter() as PluginOption,
  viteReact() as PluginOption,
];

export default defineConfig({
  plugins,
});
