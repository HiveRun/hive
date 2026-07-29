import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { launchDesktopApp, navigateInDesktopApp } from "./utils/desktop-app";
import {
  createDesktopCell,
  expectBrowserView,
  expectBrowserViewCount,
  expectWebContentsDestroyed,
  readDesktopBrowserView,
  requestDesktopBrowserViewClipboard,
  requestDesktopBrowserViewMedia,
  requestMainRendererMedia,
  requestUnownedLoopbackMedia,
  resolveDesktopApiUrl,
  startDesktopBrowserViewAudioCapture,
  syncDesktopViewerServiceTab,
  waitForDesktopCellReady,
  waitForViewerRoute,
  writeMainRendererClipboard,
} from "./utils/desktop-test-helpers";

const VIEWER_STATE_TIMEOUT_MS = 15_000;

test("loopback Hive renderer retains trusted UI permissions without microphone access", async () => {
  const rendererServer = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      '<button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Fullscreen</button>'
    );
  });
  await new Promise<void>((resolve, reject) => {
    rendererServer.once("error", reject);
    rendererServer.listen(0, "127.0.0.1", resolve);
  });
  const address = rendererServer.address() as AddressInfo;

  try {
    const { app, page } = await launchDesktopApp({
      desktopUrl: `http://127.0.0.1:${address.port}`,
      fakeMediaDevices: true,
    });
    try {
      await expect(
        requestMainRendererMedia(page, { audio: true })
      ).resolves.toMatchObject({
        errorName: "NotAllowedError",
        granted: false,
      });
      await expect(
        writeMainRendererClipboard(page, "hive-loopback-clipboard")
      ).resolves.toBeUndefined();
      await page.locator("#fullscreen").click();
      await expect
        .poll(
          async () =>
            await page.evaluate(() => Boolean(document.fullscreenElement))
        )
        .toBe(true);
    } finally {
      await app.close();
    }
  } finally {
    await new Promise<void>((resolve) => rendererServer.close(() => resolve()));
  }
});

test("desktop viewer route mounts and unmounts a native browser view", async () => {
  const apiUrl = resolveDesktopApiUrl(
    "HIVE_E2E_API_URL is required for desktop viewer tests"
  );
  const { app, page } = await launchDesktopApp({ fakeMediaDevices: true });

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
    await expect(
      requestMainRendererMedia(page, { audio: true })
    ).resolves.toMatchObject({
      errorName: "NotAllowedError",
      granted: false,
    });
    await expect(
      writeMainRendererClipboard(page, "hive-desktop-clipboard")
    ).resolves.toBeUndefined();

    const webTab = page.getByTestId("viewer-service-tab-web-browser");
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
    const webContentsId = activeView?.id;
    expect(webContentsId).toEqual(expect.any(Number));
    await expectBrowserViewCount(app, 1);

    await expect(startDesktopBrowserViewAudioCapture(app)).resolves.toEqual({
      granted: true,
      trackState: "live",
    });
    await expect(
      requestDesktopBrowserViewMedia(app, { video: true })
    ).resolves.toMatchObject({
      errorName: "NotAllowedError",
      granted: false,
    });
    await expect(
      requestDesktopBrowserViewMedia(app, { audio: true, video: true })
    ).resolves.toMatchObject({
      errorName: "NotAllowedError",
      granted: false,
    });
    await expect(
      requestUnownedLoopbackMedia(app, webRootUrl as string)
    ).resolves.toMatchObject({
      errorName: "NotAllowedError",
      granted: false,
    });
    await expect(requestDesktopBrowserViewClipboard(app)).resolves.toEqual({
      errorName: "NotAllowedError",
      granted: false,
    });

    await docsTab.click();

    await expectWebContentsDestroyed(app, webContentsId as number);

    await expectBrowserView(app, {
      url: expect.stringContaining("localhost"),
    });

    const docsRootUrl = (await readDesktopBrowserView(app))?.url;
    const docsWebContentsId = (await readDesktopBrowserView(app))?.id;
    expect(docsRootUrl).toBeTruthy();
    expect(docsWebContentsId).toEqual(expect.any(Number));
    expect(docsRootUrl).not.toBe(webRootUrl);
    await expectBrowserViewCount(app, 1);

    await syncDesktopViewerServiceTab(page, webRootUrl as string, "web");
    await expectBrowserViewCount(app, 0);
    await expectWebContentsDestroyed(app, docsWebContentsId as number);

    await page.evaluate(async () => {
      await window.hiveDesktop?.viewer.activateServiceTab("web");
    });

    await expectBrowserView(app, { url: webRootUrl });
    const recreatedWebContentsId = (await readDesktopBrowserView(app))?.id;
    expect(recreatedWebContentsId).toEqual(expect.any(Number));
    expect(recreatedWebContentsId).not.toBe(webContentsId);

    await page.getByLabel("Fullscreen").click();
    await expect
      .poll(
        async () =>
          await page.evaluate(() => Boolean(document.fullscreenElement))
      )
      .toBe(true);
    await page.evaluate(async () => await document.exitFullscreen());

    await expect(startDesktopBrowserViewAudioCapture(app)).resolves.toEqual({
      granted: true,
      trackState: "live",
    });
    await syncDesktopViewerServiceTab(page, docsRootUrl as string, "web");
    await expectBrowserViewCount(app, 0);
    await expectWebContentsDestroyed(app, recreatedWebContentsId as number);
    await page.evaluate(async () => {
      await window.hiveDesktop?.viewer.activateServiceTab("web");
    });
    await expectBrowserView(app, { url: docsRootUrl });
    const changedRootWebContentsId = (await readDesktopBrowserView(app))?.id;
    expect(changedRootWebContentsId).toEqual(expect.any(Number));
    expect(changedRootWebContentsId).not.toBe(recreatedWebContentsId);

    await syncDesktopViewerServiceTab(page, "data:text/html,invalid", "web");
    await expectBrowserViewCount(app, 0);
    await expectWebContentsDestroyed(app, changedRootWebContentsId as number);

    await syncDesktopViewerServiceTab(
      page,
      webRootUrl as string,
      "service-api:admin"
    );
    await expectWebContentsDestroyed(app, recreatedWebContentsId as number);
    await page.evaluate(async () => {
      await window.hiveDesktop?.viewer.activateServiceTab("service-api:admin");
    });
    await expectBrowserView(app, { url: webRootUrl });
    const namedPortWebContentsId = (await readDesktopBrowserView(app))?.id;
    expect(namedPortWebContentsId).toEqual(expect.any(Number));

    await navigateInDesktopApp(page, "/");

    await expectBrowserViewCount(app, 0);
    await expectWebContentsDestroyed(app, namedPortWebContentsId as number);
  } finally {
    await app.close();
  }
});
