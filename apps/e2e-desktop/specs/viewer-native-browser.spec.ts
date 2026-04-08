import { expect, test } from "@playwright/test";
import { launchDesktopApp, navigateInDesktopApp } from "./utils/desktop-app";

const VIEWER_ROUTE_TIMEOUT_MS = 30_000;
const VIEWER_STATE_TIMEOUT_MS = 15_000;
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
    });

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

    const urlInput = page.getByPlaceholder("Enter URL and press Enter...");
    await urlInput.fill(ABOUT_BLANK);
    await urlInput.press("Enter");

    await expect
      .poll(
        async () =>
          await page.evaluate(
            async () => await window.hiveDesktop?.viewer.getState()
          ),
        { timeout: VIEWER_STATE_TIMEOUT_MS }
      )
      .toMatchObject(
        expect.objectContaining({
          isVisible: true,
          url: ABOUT_BLANK,
        })
      );

    await navigateInDesktopApp(page, "/");

    await expect
      .poll(
        async () =>
          await page.evaluate(
            async () => await window.hiveDesktop?.viewer.getState()
          ),
        { timeout: VIEWER_STATE_TIMEOUT_MS }
      )
      .toMatchObject(
        expect.objectContaining({
          isVisible: false,
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

async function createCellViaApi(options: { apiUrl: string; name: string }) {
  const workspaceId = await resolveWorkspaceId(options.apiUrl);
  const response = await fetch(`${options.apiUrl}/api/cells`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      templateId: "e2e-template",
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
