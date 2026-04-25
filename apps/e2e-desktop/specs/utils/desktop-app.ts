import {
  type ElectronApplication,
  _electron as electron,
  type Page,
} from "@playwright/test";
import electronPath from "electron";

const DIAGNOSTIC_SNIPPET_LIMIT = 400;
const TRAILING_SLASH_PATTERN = /\/$/;
const rendererDiagnostics = new WeakMap<Page, string[]>();

const trimTrailingSlash = (value: string) =>
  value.replace(TRAILING_SLASH_PATTERN, "");

type LaunchDesktopAppOptions = {
  apiUrl?: string;
  startupMode?: "starting" | "reconnecting";
};

export const launchDesktopApp = async (
  options: LaunchDesktopAppOptions = {}
) => {
  const mainEntry = process.env.HIVE_E2E_DESKTOP_MAIN_ENTRY;
  const rendererEntry = process.env.HIVE_E2E_DESKTOP_RENDERER_ENTRY;
  const apiUrl = options.apiUrl ?? process.env.HIVE_E2E_API_URL;

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
      ...(apiUrl
        ? {
            HIVE_DESKTOP_BACKEND_URL: apiUrl,
            HIVE_DESKTOP_HEALTH_URL: `${trimTrailingSlash(apiUrl)}/health`,
          }
        : {}),
      ...(options.startupMode
        ? { HIVE_DESKTOP_STARTUP_MODE: options.startupMode }
        : {}),
      VITE_APP_BASE: "./",
      ...(apiUrl ? { VITE_API_URL: apiUrl } : {}),
    },
  });

  const page = await app.firstWindow();
  const messages: string[] = [];
  rendererDiagnostics.set(page, messages);
  page.on("console", (message) => {
    messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error.message}`);
  });

  return { app, page };
};

export const navigateInDesktopApp = async (page: Page, path: string) => {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
};

export const readDesktopDiagnostics = async (page: Page) => ({
  ...(await page.evaluate(
    (snippetLimit) => ({
      href: window.location.href,
      title: document.title,
      readyState: document.readyState,
      hasDesktopViewerBridge: Boolean(window.hiveDesktop?.viewer),
      runtimeInfo: window.hiveDesktop?.runtimeInfo ?? null,
      bodySnippet: (document.body?.innerText ?? "").slice(0, snippetLimit),
      hasRoot: Boolean(document.querySelector("#root")),
      rootSnippet: (document.querySelector("#root")?.innerHTML ?? "").slice(
        0,
        snippetLimit
      ),
      scriptCount: document.scripts.length,
    }),
    DIAGNOSTIC_SNIPPET_LIMIT
  )),
  rendererMessages: rendererDiagnostics.get(page) ?? [],
});

export const evaluateDesktopWindow = async <T>(
  app: ElectronApplication,
  expression: string
) =>
  await app.evaluate(async ({ BrowserWindow }, source) => {
    const window = BrowserWindow.getAllWindows()[0];

    if (!window) {
      throw new Error("No desktop window is available");
    }

    return (await window.webContents.executeJavaScript(source, true)) as T;
  }, expression);
