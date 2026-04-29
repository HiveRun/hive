import { expect, test } from "@playwright/test";
import { launchDesktopApp, readDesktopDiagnostics } from "./utils/desktop-app";

const ROOT_CONTENT_TIMEOUT_MS = 30_000;

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

test("desktop launch keeps renderer shell mounted while backend connects", async () => {
  const { app, page } = await launchDesktopApp({
    apiUrl: "http://127.0.0.1:9",
    startupMode: "starting",
  });

  try {
    await expect(page.getByTestId("app-loader")).toBeVisible({
      timeout: ROOT_CONTENT_TIMEOUT_MS,
    });
    await expect(page.getByTestId("desktop-startup-screen")).toHaveCount(0);
    const backendUrl = await page.evaluate(
      () => window.hiveDesktop?.runtimeInfo?.backendUrl
    );
    expect(backendUrl).toBe("http://127.0.0.1:9");
  } finally {
    await app.close();
  }
});
