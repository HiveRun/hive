import { _electron as electron, type Page } from "@playwright/test";
import electronPath from "electron";

const DIAGNOSTIC_SNIPPET_LIMIT = 400;

export const launchDesktopApp = async () => {
  const mainEntry = process.env.HIVE_E2E_DESKTOP_MAIN_ENTRY;
  const rendererEntry = process.env.HIVE_E2E_DESKTOP_RENDERER_ENTRY;
  const apiUrl = process.env.HIVE_E2E_API_URL;

  if (!mainEntry) {
    throw new Error("HIVE_E2E_DESKTOP_MAIN_ENTRY is required");
  }

  if (!rendererEntry) {
    throw new Error("HIVE_E2E_DESKTOP_RENDERER_ENTRY is required");
  }

  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [mainEntry],
    env: {
      ...process.env,
      HIVE_DESKTOP_RENDERER_PATH: rendererEntry,
      VITE_APP_BASE: "./",
      ...(apiUrl ? { VITE_API_URL: apiUrl } : {}),
    },
  });

  const page = await app.firstWindow();
  return { app, page };
};

export const navigateInDesktopApp = async (page: Page, path: string) => {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
};

export const readDesktopDiagnostics = async (page: Page) =>
  await page.evaluate(() => ({
    href: window.location.href,
    title: document.title,
    readyState: document.readyState,
    bodySnippet: (document.body?.innerText ?? "").slice(
      0,
      DIAGNOSTIC_SNIPPET_LIMIT
    ),
    hasRoot: Boolean(document.querySelector("#root")),
    scriptCount: document.scripts.length,
  }));
