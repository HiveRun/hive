import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { throwRunAndCleanupErrors } from "../../e2e/src/runtime/errors";
import { findAvailablePort } from "../../e2e/src/runtime/wait";
import {
  launchDesktopApp,
  launchPackagedDesktopApp,
  readDesktopDiagnostics,
} from "./utils/desktop-app";

const ROOT_CONTENT_TIMEOUT_MS = 30_000;
const FAKE_BACKEND_START_DELAY_MS = 1500;
const HTTP_OK_STATUS = 200;
const HTTP_NOT_MODIFIED_STATUS = 304;
const CACHE_GUARD_ETAG = '"desktop-cache-guard"';
const CACHE_GUARD_HTML =
  "<!doctype html><html><body><main>Desktop cache guard ready</main></body></html>";

const createDelayedHealthServerScript = (port: number) => `
setTimeout(() => {
  Bun.serve({
    hostname: "127.0.0.1",
    port: ${port},
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return Response.json({ service: "hive", status: "ok" });
      }
      return new Response("not found", { status: 404 });
    },
  });
}, ${FAKE_BACKEND_START_DELAY_MS});
setInterval(() => {}, 1000);
`;

const stopProcess = (pid?: number | null) => {
  if (!pid) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* process may already be gone */
  }
};

const expectIsolatedDesktopEnv = async (app: ElectronApplication) => {
  const hiveHome = process.env.HIVE_E2E_HIVE_HOME;
  if (!hiveHome) {
    return;
  }

  const workspaceRoot = process.env.HIVE_E2E_WORKSPACE_PATH;
  const desktopEnv = await app.evaluate(() => ({
    hiveHome: process.env.HIVE_HOME,
    logDir: process.env.HIVE_LOG_DIR,
    pidFile: process.env.HIVE_PID_FILE,
    readyFile: process.env.HIVE_READY_FILE,
    workspaceRoot: process.env.HIVE_WORKSPACE_ROOT,
  }));

  expect(desktopEnv).toMatchObject({
    hiveHome,
    logDir: join(hiveHome, "logs"),
    pidFile: join(hiveHome, "hive.pid"),
    readyFile: join(hiveHome, "daemon-ready"),
    ...(workspaceRoot ? { workspaceRoot } : {}),
  });
};

test("desktop launch smoke loads workspace shell", async () => {
  const { app, page } = await launchDesktopApp();

  try {
    await expectIsolatedDesktopEnv(app);

    try {
      await page.waitForSelector("[data-testid='workspace-create-cell']", {
        timeout: 120_000,
      });
    } catch (error) {
      const diagnostics = await readDesktopDiagnostics(page);
      throw new Error(
        `Workspace shell did not load. ${JSON.stringify(diagnostics)}. Cause: ${String(error)}`
      );
    }

    await expect(page.getByTestId("workspace-create-cell")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("desktop launch rejects stale cache without blocking the current renderer", async () => {
  const port = await findAvailablePort();
  const desktopUrl = `http://127.0.0.1:${port}`;
  const userDataDir = await mkdtemp(join(tmpdir(), "hive-desktop-cache-"));
  let readyToken = "first-launch-token";
  const renderer = createServer((request, response) => {
    if (request.headers["if-none-match"] === CACHE_GUARD_ETAG) {
      response.writeHead(HTTP_NOT_MODIFIED_STATUS, {
        "Cache-Control": "no-cache",
        ETag: CACHE_GUARD_ETAG,
      });
      response.end();
      return;
    }

    response.writeHead(HTTP_OK_STATUS, {
      "Cache-Control": "no-cache",
      "Content-Type": "text/html",
      ETag: CACHE_GUARD_ETAG,
      "X-Hive-Desktop-Ready": readyToken,
    });
    response.end(CACHE_GUARD_HTML);
  });

  let runError: unknown;
  let cleanupError: unknown;
  try {
    await new Promise<void>((resolve, reject) => {
      renderer.once("error", reject);
      renderer.listen(port, "127.0.0.1", resolve);
    });

    const firstLaunch = await launchDesktopApp({
      desktopUrl,
      readyToken,
      userDataDir,
    });
    try {
      await expect(
        firstLaunch.page.getByText("Desktop cache guard ready")
      ).toBeVisible();
    } finally {
      await firstLaunch.app.close();
    }

    readyToken = "second-launch-token";
    const secondLaunch = await launchDesktopApp({
      desktopUrl,
      readyToken,
      userDataDir,
    });
    try {
      await expect(
        secondLaunch.page.getByText("Desktop cache guard ready")
      ).toBeVisible();
    } finally {
      await secondLaunch.app.close();
    }
  } catch (error) {
    runError = error;
  } finally {
    const cleanupOutcomes = await Promise.allSettled([
      renderer.listening
        ? new Promise<void>((resolve, reject) => {
            renderer.close((error) => (error ? reject(error) : resolve()));
          })
        : Promise.resolve(),
      rm(userDataDir, { force: true, recursive: true }),
    ]);
    const cleanupFailures = cleanupOutcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : []
    );
    if (cleanupFailures.length > 0) {
      cleanupError = new AggregateError(
        cleanupFailures,
        "Desktop cache regression cleanup failed"
      );
    }
  }
  throwRunAndCleanupErrors(
    runError,
    cleanupError,
    "Desktop cache regression and cleanup failed"
  );
});

test("packaged desktop launch opens a renderer window", async () => {
  const { app, page } = await launchPackagedDesktopApp();

  try {
    await expectIsolatedDesktopEnv(app);

    await expect(page.locator("#root")).toHaveCount(1, {
      timeout: ROOT_CONTENT_TIMEOUT_MS,
    });
    await expect(page.getByTestId("workspace-create-cell")).toBeVisible({
      timeout: ROOT_CONTENT_TIMEOUT_MS,
    });
  } finally {
    await app.close();
  }
});

test("desktop launch keeps renderer shell mounted while backend connects", async () => {
  const port = await findAvailablePort();
  const apiUrl = `http://127.0.0.1:${port}`;
  let daemonPid: number | null | undefined;
  const { app, page } = await launchDesktopApp({
    apiUrl,
    daemonArgs: ["-e", createDelayedHealthServerScript(port)],
    daemonCommand: process.env.HIVE_E2E_BUN_EXECUTABLE,
    daemonCwd: process.env.HIVE_E2E_WORKSPACE_PATH,
    preserveDaemonEnv: true,
    startupMode: "starting",
    startupTimeoutMs: 15_000,
    useShellDetach: false,
  });

  try {
    await expect(page.getByTestId("app-loader")).toBeVisible({
      timeout: ROOT_CONTENT_TIMEOUT_MS,
    });
    await expect(page.getByTestId("desktop-startup-screen")).toHaveCount(0);
    const backendUrl = await page.evaluate(
      () => window.hiveDesktop?.runtimeInfo?.backendUrl
    );
    expect(backendUrl).toBe(apiUrl);

    await expect
      .poll(
        async () =>
          await page.evaluate(async () =>
            window.hiveDesktop?.startup
              ? await window.hiveDesktop.startup.getState()
              : null
          ),
        { timeout: ROOT_CONTENT_TIMEOUT_MS }
      )
      .toMatchObject({ phase: "api-ready" });

    daemonPid = (await page.evaluate(async () =>
      window.hiveDesktop?.startup
        ? (
            await window.hiveDesktop.startup.getState()
          ).pid
        : null
    )) as number | null;
  } finally {
    stopProcess(daemonPid);
    await app.close();
  }
});
