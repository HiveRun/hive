/// <reference types="vitest" />

import { defineConfig } from "vitest/config";

/**
 * Frontend Vitest Configuration
 *
 * Testing Philosophy: Frontend uses Playwright for ALL UI testing (visual snapshots only).
 * No component unit tests are configured.
 *
 * - Backend: Vitest unit tests in apps/server/src/ directory
 * - Frontend: Playwright visual snapshots in apps/web/e2e/ directory
 *
 * This config exists for monorepo compatibility and to explicitly document
 * the decision to skip frontend unit tests in favor of E2E snapshot testing.
 */
export default defineConfig({
  test: {
    include: [], // No frontend unit tests - UI validated via Playwright snapshots
  },
});
