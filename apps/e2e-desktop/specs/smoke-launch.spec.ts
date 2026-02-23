import { expect, test } from "@playwright/test";
import { launchDesktopApp, readDesktopDiagnostics } from "./utils/desktop-app";

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
