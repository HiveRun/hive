import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  terminateChild,
  waitForChildExit,
  waitForForwardedChild,
} from "./process";

const CHILD_EXIT_CODE = 7;
const SIGNAL_EXIT_CODE = 128;

describe("child process forwarding", () => {
  it("reports a child exit code", async () => {
    const child = spawn(
      process.execPath,
      ["-e", `process.exit(${CHILD_EXIT_CODE})`],
      { stdio: "ignore" }
    );

    expect(await waitForChildExit(child)).toBe(CHILD_EXIT_CODE);
  });

  it("removes forwarding handlers after a child exits", async () => {
    const before = process.listenerCount("SIGTERM");
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });

    expect(await waitForForwardedChild(child)).toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("waits for graceful exit before escalating to SIGKILL", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => undefined); console.log('ready'); setInterval(() => {}, 1000)",
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    const exit = waitForChildExit(child);
    await new Promise<void>((resolve) =>
      child.stdout?.once("data", () => resolve())
    );

    await terminateChild(child, exit, { shutdownTimeoutMs: 50 });

    expect(child.signalCode).toBe("SIGKILL");
    await expect(exit).resolves.toBe(SIGNAL_EXIT_CODE);
  });
});
