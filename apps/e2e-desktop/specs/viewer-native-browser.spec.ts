import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchDesktopApp, navigateInDesktopApp } from "./utils/desktop-app";

const VIEWER_ROUTE_TIMEOUT_MS = 30_000;
const VIEWER_STATE_TIMEOUT_MS = 15_000;
const VIEWER_CELL_READY_TIMEOUT_MS = 120_000;
const VIEWER_CELL_POLL_INTERVAL_MS = 500;
const ABOUT_BLANK = "about:blank";

test("desktop viewer route mounts and unmounts a native browser view", async () => {
  const apiUrl = resolveApiUrl();
  const { app, page } = await launchDesktopApp();

  try {
    await page.waitForSelector("[data-testid='workspace-create-cell']", {
      timeout: 120_000,
    });

    const cellId = await createCellViaApi({
      apiUrl,
      name: `Desktop Viewer Cell ${Date.now()}`,
      templateId: "viewer-template",
    });

    await waitForCellReady(apiUrl, cellId);

    await navigateInDesktopApp(page, `/cells/${cellId}/viewer`);
    await page.waitForSelector("[data-testid='cell-viewer-route']", {
      timeout: VIEWER_ROUTE_TIMEOUT_MS,
    });

    await expect
      .poll(
        async () =>
          await page.evaluate(() => Boolean(window.hiveDesktop?.viewer)),
        { timeout: VIEWER_STATE_TIMEOUT_MS }
      )
      .toBe(true);

    await expect
      .poll(async () => await readDesktopBrowserView(app), {
        timeout: VIEWER_STATE_TIMEOUT_MS,
      })
      .toMatchObject(
        expect.objectContaining({
          url: expect.stringContaining("localhost"),
          width: expect.any(Number),
          height: expect.any(Number),
        })
      );

    const initialServiceUrl = (await readDesktopBrowserView(app))?.url;
    expect(initialServiceUrl).toContain("localhost");

    const webTab = page.getByTestId("viewer-service-tab-web");
    const docsTab = page.getByTestId("viewer-service-tab-docs");
    await expect(webTab).toBeVisible();
    await expect(docsTab).toBeVisible();

    const urlInput = page.getByPlaceholder("Enter URL and press Enter...");
    await urlInput.fill(ABOUT_BLANK);
    await urlInput.press("Enter");

    await expect
      .poll(async () => await readDesktopBrowserView(app), {
        timeout: VIEWER_STATE_TIMEOUT_MS,
      })
      .toMatchObject(
        expect.objectContaining({
          url: ABOUT_BLANK,
          width: expect.any(Number),
          height: expect.any(Number),
        })
      );

    const activeView = await readDesktopBrowserView(app);
    expect(activeView?.width ?? 0).toBeGreaterThan(0);
    expect(activeView?.height ?? 0).toBeGreaterThan(0);

    await docsTab.click();

    await expect
      .poll(async () => await readDesktopBrowserView(app), {
        timeout: VIEWER_STATE_TIMEOUT_MS,
      })
      .toMatchObject(
        expect.objectContaining({
          url: expect.stringContaining("localhost"),
        })
      );

    const docsUrl = (await readDesktopBrowserView(app))?.url;
    expect(docsUrl).not.toBe(ABOUT_BLANK);

    await webTab.click();

    await expect
      .poll(async () => await readDesktopBrowserView(app), {
        timeout: VIEWER_STATE_TIMEOUT_MS,
      })
      .toMatchObject(
        expect.objectContaining({
          url: ABOUT_BLANK,
        })
      );

    await page.getByLabel("Reset to service root").click();

    await expect
      .poll(async () => await readDesktopBrowserView(app), {
        timeout: VIEWER_STATE_TIMEOUT_MS,
      })
      .toMatchObject(
        expect.objectContaining({
          url: initialServiceUrl,
        })
      );

    await navigateInDesktopApp(page, "/");

    await expect
      .poll(async () => await readDesktopBrowserView(app), {
        timeout: VIEWER_STATE_TIMEOUT_MS,
      })
      .toMatchObject(
        expect.objectContaining({
          height: 0,
          width: 0,
        })
      );
  } finally {
    await app.close();
  }
});

function resolveApiUrl() {
  const apiUrl = process.env.HIVE_E2E_API_URL;
  if (!apiUrl) {
    throw new Error("HIVE_E2E_API_URL is required for desktop viewer tests");
  }

  return apiUrl;
}

async function createCellViaApi(options: {
  apiUrl: string;
  name: string;
  templateId?: string;
}) {
  const workspaceId = await resolveWorkspaceId(options.apiUrl);
  const response = await fetch(`${options.apiUrl}/api/cells`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      templateId: options.templateId ?? "e2e-template",
      workspaceId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create desktop viewer cell: ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.message) {
    throw new Error(payload.message);
  }

  if (!payload?.id) {
    throw new Error("Desktop viewer cell response missing id");
  }

  return payload.id as string;
}

async function resolveWorkspaceId(apiUrl: string) {
  const response = await fetch(`${apiUrl}/api/workspaces`);
  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.status}`);
  }

  const payload = await response.json();
  const activeWorkspaceId = payload?.activeWorkspaceId as string | null;
  if (activeWorkspaceId) {
    return activeWorkspaceId;
  }

  const firstWorkspaceId = payload?.workspaces?.[0]?.id as string | undefined;
  if (!firstWorkspaceId) {
    throw new Error("No workspace available for desktop viewer test");
  }

  return firstWorkspaceId;
}

async function waitForCellReady(apiUrl: string, cellId: string) {
  const timeoutAt = Date.now() + VIEWER_CELL_READY_TIMEOUT_MS;

  while (Date.now() < timeoutAt) {
    const cell = await fetchCellDetail(apiUrl, cellId);
    const status = cell?.status as string | undefined;

    if (status === "ready") {
      return;
    }

    if (status === "error") {
      throw new Error(
        `Viewer cell ${cellId} entered error status: ${cell?.lastSetupError ?? "setup failed"}`
      );
    }

    await wait(VIEWER_CELL_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for viewer cell ${cellId} to become ready`
  );
}

async function fetchCellDetail(apiUrl: string, cellId: string) {
  const response = await fetch(
    `${apiUrl}/api/cells/${cellId}?includeSetupLog=false`
  );

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.message ? null : payload;
}

function wait(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function readDesktopBrowserView(app: ElectronApplication) {
  return await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const view = window?.getBrowserViews()[0];

    if (!view) {
      return null;
    }

    const bounds = view.getBounds();
    return {
      height: bounds.height,
      url: view.webContents.getURL(),
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    };
  });
}
