/// <reference types="vitest" />

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Frontend Vitest Configuration
 *
 * UI correctness is validated via Vitest-backed unit tests.
 */
export default defineConfig({
  plugins: [tsconfigPaths({ root: "./" })],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
