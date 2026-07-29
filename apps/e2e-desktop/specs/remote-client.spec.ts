import { expect, type Page, test } from "@playwright/test";
import { launchDesktopApp, readDesktopDiagnostics } from "./utils/desktop-app";

const STARTUP_TIMEOUT_MS = 30_000;

const readStartupState = (page: Page) =>
  page.evaluate(async () =>
    window.hiveDesktop?.startup
      ? await window.hiveDesktop.startup.getState()
      : null
  );

test("desktop remote-client connects without daemon startup", async () => {
  const apiUrl = process.env.HIVE_E2E_API_URL;
  if (!apiUrl) {
    throw new Error("HIVE_E2E_API_URL is required");
  }

  const { app, page } = await launchDesktopApp({
    apiUrl,
    daemonCommand: "/definitely/missing/hive-daemon",
    startupMode: "remote-client",
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    useShellDetach: false,
  });

  try {
    const diagnostics = await readDesktopDiagnostics(page);
    expect(diagnostics.runtimeInfo?.startupMode).toBe("remote-client");
    expect(diagnostics.runtimeInfo?.backendUrl).toBe(apiUrl);

    await expect
      .poll(async () => (await readStartupState(page))?.phase, {
        timeout: STARTUP_TIMEOUT_MS,
      })
      .toBe("api-ready");

    const state = await readStartupState(page);
    expect(state?.pid).toBeUndefined();
  } finally {
    await app.close();
  }
});
