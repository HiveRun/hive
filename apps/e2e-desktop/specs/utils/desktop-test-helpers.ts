import { type ElectronApplication, expect, type Page } from "@playwright/test";
import {
  createCellViaApi,
  fetchCell,
  fetchWorkspaces,
  requireApiUrl,
  wait,
  waitForCondition,
} from "../../../e2e/src/test-helpers";
import { navigateInDesktopApp } from "./desktop-app";

const CELL_READY_TIMEOUT_MS = 120_000;
const ROUTE_RETRY_DELAY_MS = 500;
const VIEWER_ROUTE_TIMEOUT_MS = 30_000;
const VIEWER_ROUTE_ATTEMPTS = 3;
const VIEWER_ROUTE_POLL_INTERVAL_MS = 100;

export function resolveDesktopApiUrl(message: string) {
  return requireApiUrl(message);
}

export async function createDesktopCell(options: {
  apiUrl: string;
  name: string;
  templateId?: string;
}) {
  const workspaceId = await resolveDesktopWorkspaceId(options.apiUrl);
  return createCellViaApi({
    apiUrl: options.apiUrl,
    name: options.name,
    templateId: options.templateId,
    workspaceId,
  });
}

export async function resolveDesktopWorkspaceId(apiUrl: string) {
  const payload = await fetchWorkspaces(apiUrl);
  const workspaceId = payload.activeWorkspaceId ?? payload.workspaces[0]?.id;
  if (!workspaceId) {
    throw new Error("No workspace available for desktop test");
  }
  return workspaceId;
}

export async function waitForDesktopCellReady(apiUrl: string, cellId: string) {
  let lastStatus = "unknown";
  await waitForCondition({
    timeoutMs: CELL_READY_TIMEOUT_MS,
    errorMessage: `Timed out waiting for desktop cell ${cellId} to become ready. lastStatus=${lastStatus}`,
    check: async () => {
      const cell = await fetchCell(apiUrl, cellId);
      lastStatus = cell.status;
      if (cell.status === "error") {
        throw new Error(
          `Desktop cell ${cellId} entered error status: ${cell.lastSetupError ?? "setup failed"}`
        );
      }
      return cell.status === "ready";
    },
  });
}

export async function waitForViewerRoute(page: Page, path: string) {
  for (let attempt = 1; attempt <= VIEWER_ROUTE_ATTEMPTS; attempt += 1) {
    await page.evaluate(
      async ({ nextPath, timeoutMs, pollIntervalMs }) => {
        window.history.pushState({}, "", nextPath);
        window.dispatchEvent(new PopStateEvent("popstate"));

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const routeVisible = Boolean(
            document.querySelector("[data-testid='cell-viewer-route']")
          );
          if (window.location.pathname === nextPath && routeVisible) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error(`Viewer route did not mount for ${nextPath}`);
      },
      {
        nextPath: path,
        pollIntervalMs: VIEWER_ROUTE_POLL_INTERVAL_MS,
        timeoutMs: VIEWER_ROUTE_TIMEOUT_MS,
      }
    );

    try {
      await page.waitForSelector("[data-testid='cell-viewer-route']", {
        timeout: VIEWER_ROUTE_TIMEOUT_MS,
      });
      return;
    } catch (error) {
      if (attempt >= VIEWER_ROUTE_ATTEMPTS) {
        throw error;
      }
      await wait(ROUTE_RETRY_DELAY_MS);
    }
  }
}

export async function readDesktopBrowserView(app: ElectronApplication) {
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

export async function expectBrowserView(
  app: ElectronApplication,
  expected: Record<string, unknown>
) {
  await expect
    .poll(async () => await readDesktopBrowserView(app), { timeout: 15_000 })
    .toMatchObject(expect.objectContaining(expected));
}

export async function openDesktopChatRoute(page: Page, cellId: string) {
  await navigateInDesktopApp(page, `/cells/${cellId}/chat`);
}
