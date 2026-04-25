import { expect, test } from "@playwright/test";
import { launchDesktopApp, readDesktopDiagnostics } from "./utils/desktop-app";

const STARTUP_PHASE_PATTERN = /Starting Hive daemon|Connecting to Hive/i;

test("desktop launch smoke loads workspace shell", async () => {
  const { app, page } = await launchDesktopApp();

  try {
    try {
      await page.waitForSelector("[data-testid='workspace-create-cell']", {
        timeout: 120_000,
      });
    } catch (error) {
      const diagnostics = await readDesktopDiagnostics(page);
      throw new Error(
        `Workspace shell did not load. ${JSON.stringify(diagnostics)}. Cause: ${String(error)}`
      );
    }

    await expect(page.getByTestId("workspace-create-cell")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("desktop launch shows in-window startup while backend connects", async () => {
  const { app, page } = await launchDesktopApp({
    apiUrl: "http://127.0.0.1:9",
    startupMode: "starting",
  });

  try {
    await expect(page.getByTestId("desktop-startup-screen")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("desktop-startup-phase")).toContainText(
      STARTUP_PHASE_PATTERN
    );
  } finally {
    await app.close();
  }
});
