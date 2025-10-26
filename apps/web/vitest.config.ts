/// <reference types="vitest" />

import { defineConfig } from "vitest/config";

// Frontend uses Playwright for UI testing (E2E + snapshots)
// No unit tests configured - this file exists for monorepo compatibility
export default defineConfig({
  test: {
    include: [], // No unit tests to run
  },
});
