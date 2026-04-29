import { afterEach, describe, expect, it, vi } from "vitest";

const PREVIOUS_TIMEOUT_ATTEMPT_COUNT = 400;
const PREVIOUS_TIMEOUT_MS = 120_000;
const SUCCESSFUL_ATTEMPT = PREVIOUS_TIMEOUT_ATTEMPT_COUNT + 1;

type TestDesktopWindow = {
  hiveDesktop?: {
    runtimeInfo: {
      runtime: "electron";
      version: string;
      platform: string;
      backendUrl: string;
      healthUrl: string;
      startupMode: "starting" | "reconnecting";
    };
  };
};

const installDesktopRuntime = () => {
  (window as unknown as TestDesktopWindow).hiveDesktop = {
    runtimeInfo: {
      runtime: "electron",
      version: "test",
      platform: "linux",
      backendUrl: "http://localhost:3000",
      healthUrl: "http://localhost:3000/health",
      startupMode: "starting",
    },
  };
};

const importDesktopStartup = async () => {
  vi.resetModules();
  installDesktopRuntime();
  return await import("./desktop-startup");
};

describe("desktop startup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    (window as unknown as TestDesktopWindow).hiveDesktop = undefined;
  });

  it("keeps polling after the previous 400-attempt timeout boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return new Response(
          JSON.stringify(
            calls > PREVIOUS_TIMEOUT_ATTEMPT_COUNT
              ? { service: "hive", status: "ok" }
              : { service: "not-hive", status: "starting" }
          ),
          { status: 200 }
        );
      })
    );

    const { ensureDesktopBackendReady, getDesktopStartupSnapshot } =
      await importDesktopStartup();

    const ready = ensureDesktopBackendReady();
    await vi.advanceTimersByTimeAsync(PREVIOUS_TIMEOUT_MS);
    await ready;

    expect(calls).toBeGreaterThan(PREVIOUS_TIMEOUT_ATTEMPT_COUNT);
    expect(getDesktopStartupSnapshot()).toMatchObject({
      attempt: SUCCESSFUL_ATTEMPT,
      message: "Loading workspaces",
      phase: "loading-workspaces",
    });
  });
});
