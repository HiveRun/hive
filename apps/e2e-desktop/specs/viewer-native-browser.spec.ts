import { expect, test } from "@playwright/test";
import { launchDesktopApp } from "./utils/desktop-app";

const ABOUT_BLANK = "about:blank";

test("desktop viewer bridge manages native surface lifecycle", async () => {
  const { app, page } = await launchDesktopApp();

  try {
    await page.waitForSelector("[data-testid='workspace-create-cell']", {
      timeout: 120_000,
    });

    await page.evaluate(async (url) => {
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
      desktop.viewer.navigate(url).catch(() => {
        /* allow polling to observe failure state */
      });
    }, ABOUT_BLANK);

    await expect
      .poll(
        async () =>
          await page.evaluate(
            async () => await window.hiveDesktop?.viewer.getState()
          )
      )
      .toMatchObject({
        isVisible: true,
        url: ABOUT_BLANK,
      });

    await page.evaluate(async () => {
      await window.hiveDesktop?.viewer.hide();
    });

    await expect
      .poll(
        async () =>
          await page.evaluate(
            async () => await window.hiveDesktop?.viewer.getState()
          )
      )
      .toMatchObject({
        isVisible: false,
      });
  } finally {
    await app.close();
  }
});
