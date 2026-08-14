import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  assertAndroidStartupActive,
  buildAndroidProductGuardianArgs,
  cleanupAndroidEmulator,
  cleanupAndroidSession,
  stopRecordedAndroidProduct,
} from "./emulator";
import { getAndroidProcessFingerprint } from "./lease";
import { sanitizeAdbServerEnvironment } from "./policy";
import { isProcessGroupRunning, waitForChildExit } from "./process";

const TEST_SHUTDOWN_TIMEOUT_SECONDS = 1;
const DESCENDANT_PRODUCT_EXIT_CODE = 7;

const spawnDetachedTestProduct = ({
  command = [process.execPath, "-e", "setInterval(() => {}, 1000)"],
  env,
  stdin = "ignore",
  stdout = "ignore",
}: {
  command?: string[];
  env?: NodeJS.ProcessEnv;
  stdin?: "ignore" | "pipe";
  stdout?: "ignore" | "pipe";
} = {}) => {
  const marker = `hive-android-test-${randomUUID()}`;
  const child = spawn(
    "/bin/sh",
    buildAndroidProductGuardianArgs(
      marker,
      command,
      TEST_SHUTDOWN_TIMEOUT_SECONDS
    ),
    {
      detached: true,
      env,
      stdio: [stdin, stdout, "ignore", "pipe"],
    }
  );
  if (!child.pid) {
    throw new Error("Test product process did not report a pid");
  }
  const control = child.stdio[3];
  if (!(control && "write" in control)) {
    throw new Error("Test product guardian control pipe is unavailable");
  }
  control.write("start\n");
  return {
    control,
    exit: waitForChildExit(child),
    marker,
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
  };
};

const killDetachedTestProduct = async (pid: number, exit: Promise<number>) => {
  if (isProcessGroupRunning(pid)) {
    process.kill(-pid, "SIGKILL");
  }
  await exit;
};

describe("Android emulator startup", () => {
  it("removes alternate ADB server routing from Hive-owned commands", () => {
    const environment = sanitizeAdbServerEnvironment({
      ADB_SERVER_SOCKET: "tcp:other-host:5038",
      ANDROID_ADB_SERVER_ADDRESS: "other-host",
      ANDROID_ADB_SERVER_PORT: "5038",
      ANDROID_HOME: "/opt/android-sdk",
    });

    expect(environment.ADB_SERVER_SOCKET).toBeUndefined();
    expect(environment.ANDROID_ADB_SERVER_ADDRESS).toBeUndefined();
    expect(environment.ANDROID_ADB_SERVER_PORT).toBeUndefined();
  });

  it("stops startup after shutdown begins", () => {
    expect(() => assertAndroidStartupActive(true)).toThrow(
      "Hive Android startup was interrupted."
    );
    expect(() => assertAndroidStartupActive(false)).not.toThrow();
  });
});

describe("Android emulator cleanup", () => {
  it("terminates the recorded orphaned product process group", async () => {
    const { exit, marker, pid } = spawnDetachedTestProduct();
    const originalColumns = process.env.COLUMNS;
    process.env.COLUMNS = "40";

    try {
      await stopRecordedAndroidProduct({
        productFingerprint: getAndroidProcessFingerprint(pid) ?? undefined,
        productMarker: marker,
        productPid: pid,
      });
      await exit;
      expect(isProcessGroupRunning(pid)).toBe(false);
    } finally {
      process.env.COLUMNS = originalColumns;
      await killDetachedTestProduct(pid, exit);
    }
  });

  it("refuses to terminate a reused product pid", async () => {
    const { exit, marker, pid } = spawnDetachedTestProduct();

    try {
      await expect(
        stopRecordedAndroidProduct({
          productFingerprint: "different-process-start",
          productMarker: marker,
          productPid: pid,
        })
      ).rejects.toThrow("Refusing to terminate unverified");
      expect(isProcessGroupRunning(pid)).toBe(true);
    } finally {
      await killDetachedTestProduct(pid, exit);
    }
  });

  it("stops the product group when the wrapper control pipe closes", async () => {
    const { control, exit, pid } = spawnDetachedTestProduct();

    control.end();
    await exit;

    expect(isProcessGroupRunning(pid)).toBe(false);
  });

  it("preserves product stdin through the guardian", async () => {
    const child = spawnDetachedTestProduct({
      command: [
        process.execPath,
        "-e",
        "process.stdin.once('data', (data) => { process.stdout.write(data); process.exit(0); })",
      ],
      stdin: "pipe",
      stdout: "pipe",
    });
    const input = "preserved product input\n";
    let output = "";

    try {
      if (!(child.stdin && "write" in child.stdin)) {
        throw new Error("Test product stdin is unavailable");
      }
      if (!(child.stdout && "on" in child.stdout)) {
        throw new Error("Test product stdout is unavailable");
      }
      child.stdout.on("data", (data) => {
        output += String(data);
      });
      child.stdin.end(input);
      await child.exit;

      expect(output).toBe(input);
    } finally {
      await killDetachedTestProduct(child.pid, child.exit);
    }
  });

  it("force-stops a product group that ignores graceful shutdown", async () => {
    const { control, exit, pid } = spawnDetachedTestProduct({
      command: [
        process.execPath,
        "-e",
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
      ],
      env: { PATH: "/definitely/missing" },
    });

    try {
      control.end();
      await exit;

      expect(isProcessGroupRunning(pid)).toBe(false);
    } finally {
      await killDetachedTestProduct(pid, exit);
    }
  });

  it("cleans resistant descendants while preserving product status", async () => {
    const child = spawnDetachedTestProduct({
      command: [
        "/bin/sh",
        "-c",
        "trap '' TERM; while :; do sleep 1; done & exit 7",
      ],
    });

    try {
      expect(await child.exit).toBe(DESCENDANT_PRODUCT_EXIT_CODE);
      expect(isProcessGroupRunning(child.pid)).toBe(false);
    } finally {
      await killDetachedTestProduct(child.pid, child.exit);
    }
  });

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
