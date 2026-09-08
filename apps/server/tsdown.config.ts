import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src/server.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  copy: [{ from: "src/agents/tools/hive.ts", to: "dist/tools/hive.ts" }],
  noExternal: [/@hive\/.*/],
});
