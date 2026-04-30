import { createServer } from "node:net";
import { expect, test } from "@playwright/test";
import {
  launchDesktopApp,
  launchPackagedDesktopApp,
  readDesktopDiagnostics,
} from "./utils/desktop-app";

const ROOT_CONTENT_TIMEOUT_MS = 30_000;
const FAKE_BACKEND_START_DELAY_MS = 1500;

const findAvailablePort = async () =>
  await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!(address && typeof address === "object" && address.port)) {
        server.close(() => reject(new Error("Failed to allocate port")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });

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

test("desktop launch smoke loads workspace shell", async () => {
  const { app, page } = await launchDesktopApp();

  try {
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

test("packaged desktop launch opens a renderer window", async () => {
  const { app, page } = await launchPackagedDesktopApp();

  try {
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
