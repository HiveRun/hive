import { expect, test } from "@playwright/test";
import { launchDesktopApp, navigateInDesktopApp } from "./utils/desktop-app";
import {
  createDesktopCell,
  expectBrowserView,
  readDesktopBrowserView,
  resolveDesktopApiUrl,
  waitForDesktopCellReady,
  waitForViewerRoute,
} from "./utils/desktop-test-helpers";

const VIEWER_STATE_TIMEOUT_MS = 15_000;
test("desktop viewer route mounts and unmounts a native browser view", async () => {
  const apiUrl = resolveDesktopApiUrl(
    "HIVE_E2E_API_URL is required for desktop viewer tests"
  );
  const { app, page } = await launchDesktopApp();

  try {
    await page.waitForSelector("[data-testid='workspace-create-cell']", {
      timeout: 120_000,
    });

    const cellId = await createDesktopCell({
      apiUrl,
      name: `Desktop Viewer Cell ${Date.now()}`,
      templateId: "viewer-template",
    });

    await waitForDesktopCellReady(apiUrl, cellId);

    await waitForViewerRoute(page, `/cells/${cellId}/viewer`);

    await expect
      .poll(
        async () =>
          await page.evaluate(() =>
            Boolean(
              (
                window as Window & {
                  hiveDesktop?: { viewer?: unknown };
                }
              ).hiveDesktop?.viewer
            )
          ),
        { timeout: VIEWER_STATE_TIMEOUT_MS }
      )
      .toBe(true);

    const webTab = page.getByTestId("viewer-service-tab-web");
    const docsTab = page.getByTestId("viewer-service-tab-docs");
    await expect(webTab).toBeVisible();
    await expect(docsTab).toBeVisible();

    await webTab.click();

    await expectBrowserView(app, {
      height: expect.any(Number),
      url: expect.stringContaining("localhost"),
      width: expect.any(Number),
    });

    const webRootUrl = (await readDesktopBrowserView(app))?.url;
    expect(webRootUrl).toBeTruthy();

    const activeView = await readDesktopBrowserView(app);
    expect(activeView?.width ?? 0).toBeGreaterThan(0);
    expect(activeView?.height ?? 0).toBeGreaterThan(0);

    await docsTab.click();

    await expectBrowserView(app, {
      url: expect.stringContaining("localhost"),
    });

    const docsRootUrl = (await readDesktopBrowserView(app))?.url;
    expect(docsRootUrl).toBeTruthy();
    expect(docsRootUrl).not.toBe(webRootUrl);

    await webTab.click();

    await expectBrowserView(app, { url: webRootUrl });

    await navigateInDesktopApp(page, "/");

    await expectBrowserView(app, { height: 0, width: 0 });
  } finally {
    await app.close();
  }
});
