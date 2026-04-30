import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  entry: ["./src/main.ts", "./src/preload.ts"],
  external: ["electron"],
  format: "cjs",
  noExternal: ["@hive/daemon-runtime"],
  outDir: "./dist",
});
