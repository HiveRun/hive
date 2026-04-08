import { expect, test } from "@playwright/test";
import {
  evaluateDesktopWindow,
  launchDesktopApp,
  readDesktopDiagnostics,
} from "./utils/desktop-app";

const ABOUT_BLANK = "about:blank";

test("desktop viewer bridge manages native surface lifecycle", async () => {
  test.fixme(
    true,
    "Desktop Playwright currently does not expose the hiveDesktop preload bridge in the packaged renderer."
  );

  const { app, page } = await launchDesktopApp();

  try {
    await page.waitForSelector("[data-testid='workspace-create-cell']", {
      timeout: 120_000,
    });

    try {
      await expect
        .poll(
          async () =>
            await evaluateDesktopWindow<boolean>(
              app,
              "Boolean(window.hiveDesktop?.viewer)"
            ),
          { timeout: 30_000 }
        )
        .toBe(true);
    } catch (error) {
      const diagnostics = await readDesktopDiagnostics(page);
      throw new Error(
        `Desktop viewer bridge never became available. ${JSON.stringify(diagnostics)}. Cause: ${String(error)}`
      );
    }

    await evaluateDesktopWindow(
      app,
      `(async () => {
        const desktop = window.hiveDesktop;
        if (!desktop?.viewer) {
          throw new Error("Desktop viewer bridge is unavailable");
        }

        await desktop.viewer.show({
          height: 320,
          width: 480,
          x: 40,
          y: 120,
        });

        desktop.viewer.navigate(${JSON.stringify(ABOUT_BLANK)}).catch(() => {
          /* allow polling to observe failure state */
        });
      })()`
    );

    await expect
      .poll(
        async () =>
          await evaluateDesktopWindow(
            app,
            "window.hiveDesktop?.viewer.getState()"
          )
      )
      .toMatchObject({
        isVisible: true,
        url: ABOUT_BLANK,
      });

    await evaluateDesktopWindow(app, "window.hiveDesktop?.viewer.hide()");

    await expect
      .poll(
        async () =>
          await evaluateDesktopWindow(
            app,
            "window.hiveDesktop?.viewer.getState()"
          )
      )
      .toMatchObject({
        isVisible: false,
      });
  } finally {
    await app.close();
  }
});
