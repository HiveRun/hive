import { join } from "node:path";
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

const resolveApiUrl = (apiUrl?: string) =>
  apiUrl ?? process.env.HIVE_E2E_API_URL;

const createIsolatedHiveEnv = () => {
  const hiveHome = process.env.HIVE_E2E_HIVE_HOME;
  const workspaceRoot = process.env.HIVE_E2E_WORKSPACE_PATH;

  return {
    ...(hiveHome
      ? {
          HIVE_HOME: hiveHome,
          HIVE_LOG_DIR: join(hiveHome, "logs"),
          HIVE_PID_FILE: join(hiveHome, "hive.pid"),
          HIVE_READY_FILE: join(hiveHome, "daemon-ready"),
        }
      : {}),
    ...(workspaceRoot ? { HIVE_WORKSPACE_ROOT: workspaceRoot } : {}),
  };
};

const createDesktopRuntimeEnv = (
  apiUrl: string | undefined,
  options: LaunchDesktopAppOptions = {}
) => ({
  ...process.env,
  ...createIsolatedHiveEnv(),
  ...(apiUrl
    ? {
        HIVE_DESKTOP_BACKEND_URL: apiUrl,
        HIVE_DESKTOP_HEALTH_URL: `${trimTrailingSlash(apiUrl)}/health`,
        VITE_API_URL: apiUrl,
      }
    : {}),
  ...(options.startupMode
    ? { HIVE_DESKTOP_STARTUP_MODE: options.startupMode }
    : {}),
  ...(options.daemonCommand
    ? { HIVE_DESKTOP_DAEMON_COMMAND: options.daemonCommand }
    : {}),
  ...(options.daemonArgs
    ? { HIVE_DESKTOP_DAEMON_ARGS: JSON.stringify(options.daemonArgs) }
    : {}),
  ...(options.daemonCwd ? { HIVE_DESKTOP_DAEMON_CWD: options.daemonCwd } : {}),
  ...(options.preserveDaemonEnv
    ? { HIVE_DESKTOP_PRESERVE_DAEMON_ENV: "1" }
    : {}),
  ...(typeof options.startupTimeoutMs === "number"
    ? { HIVE_DESKTOP_STARTUP_TIMEOUT_MS: String(options.startupTimeoutMs) }
    : {}),
  ...(typeof options.useShellDetach === "boolean"
    ? {
        HIVE_DESKTOP_DAEMON_USE_SHELL_DETACH: options.useShellDetach
          ? "1"
          : "0",
      }
    : {}),
  VITE_APP_BASE: "./",
});

type LaunchDesktopAppOptions = {
  apiUrl?: string;
  daemonArgs?: string[];
  daemonCommand?: string;
  daemonCwd?: string;
  preserveDaemonEnv?: boolean;
  startupMode?: "starting" | "reconnecting" | "remote-client";
  startupTimeoutMs?: number;
  useShellDetach?: boolean;
};

export const launchDesktopApp = async (
  options: LaunchDesktopAppOptions = {}
) => {
  const mainEntry = process.env.HIVE_E2E_DESKTOP_MAIN_ENTRY;
  const rendererEntry = process.env.HIVE_E2E_DESKTOP_RENDERER_ENTRY;
  const apiUrl = resolveApiUrl(options.apiUrl);

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
      ...createDesktopRuntimeEnv(apiUrl, options),
      HIVE_DESKTOP_RENDERER_PATH: rendererEntry,
    },
  });

  const page = await app.firstWindow();
  trackDesktopPage(page);

  return { app, page };
};

export const launchPackagedDesktopApp = async (
  options: LaunchDesktopAppOptions = {}
) => {
  const executablePath = process.env.HIVE_E2E_DESKTOP_PACKAGED_EXECUTABLE;
  if (!executablePath) {
    throw new Error("HIVE_E2E_DESKTOP_PACKAGED_EXECUTABLE is required");
  }

  const app = await electron.launch({
    executablePath,
    env: createDesktopRuntimeEnv(resolveApiUrl(options.apiUrl), options),
  });

  const page = await app.firstWindow();
  trackDesktopPage(page);

  return { app, page };
};

const trackDesktopPage = (page: Page) => {
  const messages: string[] = [];
  rendererDiagnostics.set(page, messages);
  page.on("console", (message) => {
    messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error.message}`);
  });
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
