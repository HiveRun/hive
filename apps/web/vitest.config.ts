/// <reference types="vitest" />

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Frontend Vitest Configuration
 *
 * UI correctness is still gated on Playwright visual snapshots, but we
 * allow lightweight logic tests (e.g., streaming helpers) to run in Vitest
 * so regressions surface quickly during local development.
 */
export default defineConfig({
  plugins: [tsconfigPaths({ root: "./" })],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
