import { describe, expect, it, vi } from "vitest";

import { cleanupAndroidEmulator, cleanupAndroidSession } from "./emulator";

describe("Android emulator cleanup", () => {
  it("falls back to process termination when graceful shutdown fails", async () => {
    const events: string[] = [];
    let devicePresent = true;

    await cleanupAndroidEmulator({
      isDevicePresent: () => devicePresent,
      stopExpected: () => {
        events.push("graceful");
        return Promise.reject(new Error("adb timed out"));
      },
      terminateProcess: () => {
        events.push("process");
        devicePresent = false;
        return Promise.resolve();
      },
    });

    expect(events).toEqual(["graceful", "process"]);
  });

  it("retains the lease when fallback termination leaves the device connected", async () => {
    await expect(
      cleanupAndroidEmulator({
        isDevicePresent: () => true,
        stopExpected: () => Promise.reject(new Error("adb timed out")),
        terminateProcess: () => Promise.resolve(),
      })
    ).rejects.toThrow("adb timed out");
  });

  it("runs every cleanup task and retains the lease when any task fails", async () => {
    const completed: string[] = [];
    const releaseLease = vi.fn().mockResolvedValue(undefined);

    await expect(
      cleanupAndroidSession(
        [
          {
            label: "product process",
            run: () => {
              completed.push("product");
              return Promise.reject(new Error("product cleanup failed"));
            },
          },
          {
            label: "emulator process",
            run: () => {
              completed.push("emulator");
              return Promise.resolve();
            },
          },
          {
            label: "ADB emulator",
            run: () => {
              completed.push("adb");
              return Promise.resolve();
            },
          },
        ],
        releaseLease
      )
    ).rejects.toThrow("retaining the emulator lease");
    expect(completed).toEqual(["product", "emulator", "adb"]);
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it("releases the lease only after every cleanup task succeeds", async () => {
    const releaseLease = vi.fn().mockResolvedValue(undefined);

    await cleanupAndroidSession(
      [
        { label: "product process", run: () => Promise.resolve() },
        { label: "emulator process", run: () => Promise.resolve() },
      ],
      releaseLease
    );

    expect(releaseLease).toHaveBeenCalledOnce();
  });
});
