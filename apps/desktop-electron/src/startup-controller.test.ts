import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopStartupState } from "./desktop-runtime-types";
import { createDesktopStartupController } from "./startup-controller";

const ENV_KEYS = [
  "HIVE_DESKTOP_BACKEND_URL",
  "HIVE_DESKTOP_HEALTH_URL",
  "HIVE_DESKTOP_INSTANCE_NAME",
  "HIVE_DESKTOP_STARTUP_MODE",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

const restoreEnv = () => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

describe("createDesktopStartupController", () => {
  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("connects in remote-client mode without creating a daemon runtime", async () => {
    process.env.HIVE_DESKTOP_BACKEND_URL = "https://hive.example.com";
    process.env.HIVE_DESKTOP_HEALTH_URL = "https://hive.example.com/health";
    process.env.HIVE_DESKTOP_INSTANCE_NAME = "company";
    process.env.HIVE_DESKTOP_STARTUP_MODE = "remote-client";

    const createDaemonRuntime = vi.fn(() => {
      throw new Error("daemon runtime should not be created");
    });
    const waitForServerReady = vi.fn().mockResolvedValue(true);
    const controller = createDesktopStartupController({
      createDaemonRuntime: createDaemonRuntime as never,
      waitForServerReady,
    });
    const states: DesktopStartupState[] = [];
    const unsubscribe = controller.subscribe((state) => states.push(state));

    await controller.start();
    unsubscribe();

    expect(createDaemonRuntime).not.toHaveBeenCalled();
    expect(waitForServerReady).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://hive.example.com/health",
      })
    );
    expect(states.some((state) => state.phase === "remote-client")).toBe(true);
    expect(controller.getState()).toMatchObject({
      backendUrl: "https://hive.example.com",
      phase: "api-ready",
    });
  });
});
