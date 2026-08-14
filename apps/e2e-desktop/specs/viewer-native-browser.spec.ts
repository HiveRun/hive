import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { launchDesktopApp, navigateInDesktopApp } from "./utils/desktop-app";
import {
  approveDesktopMicrophonePrompts,
  createDesktopCell,
  expectBrowserView,
  expectBrowserViewCount,
  expectWebContentsDestroyed,
  readDesktopBrowserView,
  readDesktopMicrophonePromptCount,
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

const expectPermissionDenied = (
  request: Promise<{ errorName: string | null; granted: boolean }>
) =>
  expect(request).resolves.toEqual({
    errorName: "NotAllowedError",
    granted: false,
  });

const expectFullscreen = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);

const expectDesktopAudioCaptureGranted = async (
  app: ElectronApplication,
  expectedPromptCount: number
) => {
  await expect(startDesktopBrowserViewAudioCapture(app)).resolves.toEqual({
    granted: true,
    trackState: "live",
  });
  await expect
    .poll(() => readDesktopMicrophonePromptCount(app))
    .toBe(expectedPromptCount);
};

const activateSyncedBrowserView = async (
  app: ElectronApplication,
  page: Page,
  rootUrl: string,
  options: {
    audioInput?: boolean;
    previousId?: number;
    serviceId?: string;
  } = {}
) => {
  const { audioInput = true, previousId, serviceId = "web" } = options;
  await syncDesktopViewerServiceTab(page, rootUrl, serviceId, audioInput);
  await expectBrowserViewCount(app, 0);
  if (previousId !== undefined) {
    await expectWebContentsDestroyed(app, previousId);
  }
  await page.evaluate(
    (id) => window.hiveDesktop?.viewer.activateServiceTab(id),
    serviceId
  );
  await expectBrowserView(app, { url: rootUrl });
  await expectBrowserViewCount(app, 1);

  const nextId = (await readDesktopBrowserView(app))?.id;
  expect(nextId).toEqual(expect.any(Number));
  expect(nextId).not.toBe(previousId);
  return nextId as number;
};

test("loopback Hive renderer retains trusted UI and microphone permissions", async () => {
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
      await approveDesktopMicrophonePrompts(app);
      await expect(
        requestMainRendererMedia(page, { audio: true })
      ).resolves.toEqual({
        errorName: null,
        granted: true,
      });
      await expect(
        writeMainRendererClipboard(page, "hive-loopback-clipboard")
      ).resolves.toBeUndefined();
      await page.locator("#fullscreen").click();
      await expectFullscreen(page);
      await expect.poll(() => readDesktopMicrophonePromptCount(app)).toBe(1);
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
    await approveDesktopMicrophonePrompts(app);
    await expect(
      requestMainRendererMedia(page, { audio: true })
    ).resolves.toEqual({
      errorName: null,
      granted: true,
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

    const activeView = await readDesktopBrowserView(app);
    const webRootUrl = activeView?.url;
    expect(webRootUrl).toBeTruthy();
    expect(activeView?.width ?? 0).toBeGreaterThan(0);
    expect(activeView?.height ?? 0).toBeGreaterThan(0);
    const webContentsId = activeView?.id;
    expect(webContentsId).toEqual(expect.any(Number));
    await expectBrowserViewCount(app, 1);

    await approveDesktopMicrophonePrompts(app);
    await expectDesktopAudioCaptureGranted(app, 1);
    await expectPermissionDenied(
      requestDesktopBrowserViewMedia(app, { video: true })
    );
    await expectPermissionDenied(
      requestDesktopBrowserViewMedia(app, { audio: true, video: true })
    );
    await expectPermissionDenied(
      requestUnownedLoopbackMedia(app, webRootUrl as string)
    );
    await expectPermissionDenied(requestDesktopBrowserViewClipboard(app));

    await docsTab.click();

    await expectWebContentsDestroyed(app, webContentsId as number);

    await expectBrowserView(app, {
      url: expect.stringContaining("localhost"),
    });

    const docsView = await readDesktopBrowserView(app);
    const docsRootUrl = docsView?.url;
    const docsWebContentsId = docsView?.id;
    expect(docsRootUrl).toBeTruthy();
    expect(docsWebContentsId).toEqual(expect.any(Number));
    expect(docsRootUrl).not.toBe(webRootUrl);
    await expectBrowserViewCount(app, 1);

    const recreatedWebContentsId = await activateSyncedBrowserView(
      app,
      page,
      webRootUrl as string,
      { previousId: docsWebContentsId }
    );
    expect(recreatedWebContentsId).not.toBe(webContentsId);

    await page.getByLabel("Fullscreen").click();
    await expectFullscreen(page);
    await page.evaluate(async () => await document.exitFullscreen());

    await expectDesktopAudioCaptureGranted(app, 2);
    const disabledAudioWebContentsId = await activateSyncedBrowserView(
      app,
      page,
      webRootUrl as string,
      { audioInput: false, previousId: recreatedWebContentsId }
    );
    await expect(startDesktopBrowserViewAudioCapture(app)).resolves.toEqual({
      granted: false,
      trackState: "NotAllowedError",
    });
    await expect.poll(() => readDesktopMicrophonePromptCount(app)).toBe(2);
    const changedRootWebContentsId = await activateSyncedBrowserView(
      app,
      page,
      docsRootUrl as string,
      { previousId: disabledAudioWebContentsId }
    );

    await syncDesktopViewerServiceTab(page, "data:text/html,invalid", "web");
    await expectBrowserViewCount(app, 0);
    await expectWebContentsDestroyed(app, changedRootWebContentsId as number);

    const namedPortWebContentsId = await activateSyncedBrowserView(
      app,
      page,
      webRootUrl as string,
      { serviceId: "service-api:admin" }
    );

    await navigateInDesktopApp(page, "/");

    await expectBrowserViewCount(app, 0);
    await expectWebContentsDestroyed(app, namedPortWebContentsId as number);
  } finally {
    await app.close();
  }
});
